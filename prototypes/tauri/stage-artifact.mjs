#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createPrototypePlan, parsePrototypeArguments } from './run.mjs';
import { describeTauriPrototypeTarget, tauriPrototypeRustTarget } from './build-targets.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const capture = promisify(execFile);
const REQUIRED_FILES = [
	'LICENSE', 'THIRD_PARTY_LICENSES.md', 'prototypes/tauri/README.md',
	'prototypes/tauri/host/Cargo.toml', 'prototypes/tauri/host/Cargo.lock',
	'prototypes/tauri/host/rust-toolchain.toml',
];

/** @typedef {{ id: string, name: string, version: string, manifest_path: string,
 * license: string | null, license_file: string | null, repository: string | null,
 * source: string | null }} CargoPackage */
/** @typedef {{ packages: CargoPackage[], resolve: { root: string | null,
 * nodes: { id: string, dependencies: string[] }[] } | null }} CargoMetadata */
/** @typedef {(command: string, args: string[], options: { cwd: string }) => Promise<string>} Execute */
/** @typedef {{ source: string, destination: string }} NoticeFile */
/** @typedef {Pick<CargoPackage, 'name' | 'version' | 'license' | 'repository' | 'source'> & { files: string[] }} RustInventory */

/** @type {Execute} */
async function executeCapture(command, args, { cwd }) {
	const { stdout } = await capture(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	return stdout;
}

/**
 * Stage standalone release bytes with their source pins and dependency notices.
 * Inject metadata in filesystem tests so no Rust toolchain or registry is needed.
 * @param {{ root: string, platform?: string, revision?: string, target?: string, environment?: NodeJS.ProcessEnv }} options
 * @param {{ metadata?: CargoMetadata, execute?: Execute }} [dependencies]
 */
export async function stagePrototypeArtifact(options, dependencies = {}) {
	const environment = options.environment ?? process.env;
	const target = options.target ?? environment.SOUNDSCAPER_TAURI_TARGET;
	const platform = options.platform ?? process.platform;
	const plan = createPrototypePlan({ root: options.root, platform, target, command: 'build', release: true });
	const execute = dependencies.execute ?? executeCapture;
	const revision = (options.revision ?? environment.SOUNDSCAPER_SOURCE_REVISION ?? environment.GITHUB_SHA
		?? await execute('git', ['rev-parse', 'HEAD'], { cwd: plan.repositoryRoot })).trim();
	if (!/^[a-f0-9]{40}$/u.test(revision)) throw new Error('A full Git source revision is required for the prototype artifact.');
	for (const name of [...REQUIRED_FILES, relative(plan.repositoryRoot, plan.executable)]) {
		await requireInput(resolve(plan.repositoryRoot, name), 'Required prototype artifact input');
	}
	await requireInput(resolve(plan.repositoryRoot, 'LICENSES'), 'Required prototype artifact input', true);
	const resolved = dependencies.metadata === undefined
		? await loadMetadata(plan.hostDirectory, execute, target)
		: { metadata: dependencies.metadata, rustTarget: target ?? tauriPrototypeRustTarget(
			platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : platform, process.arch,
		) };
	const artifactTarget = describeTauriPrototypeTarget(resolved.rustTarget);
	const metadata = resolved.metadata;
	const packages = resolvedDependencies(metadata);
	/** @type {RustInventory[]} */
	const inventories = [];
	/** @type {{ directory: string, files: NoticeFile[] }[]} */
	const notices = [];
	for (const dependency of packages) {
		if (!/^[A-Za-z0-9_.+-]+$/u.test(dependency.name) || !/^[A-Za-z0-9_.+-]+$/u.test(dependency.version)) {
			throw new Error(`Invalid Rust dependency identity: ${dependency.name}@${dependency.version}`);
		}
		const directory = `${dependency.name}-${dependency.version}`;
		const files = await dependencyNoticeFiles(dependency);
		notices.push({ directory, files });
		inventories.push({ name: dependency.name, version: dependency.version, license: dependency.license,
			repository: dependency.repository, source: dependency.source,
			files: files.map(({ destination }) => destination.split(sep).join('/')) });
	}
	await mkdir(plan.outputRoot, { recursive: true });
	const staging = await mkdtemp(resolve(plan.outputRoot, '.artifact-staging-'));
	const artifact = resolve(plan.outputRoot, 'artifact');
	try {
		await cp(plan.executable, resolve(staging, basename(plan.executable)));
		for (const name of REQUIRED_FILES) {
			const destination = resolve(staging, name === 'prototypes/tauri/README.md' ? 'README.md' : name);
			await mkdir(dirname(destination), { recursive: true });
			await cp(resolve(plan.repositoryRoot, name), destination);
		}
		await cp(resolve(plan.repositoryRoot, 'LICENSES'), resolve(staging, 'LICENSES'), { recursive: true });
		await writeFile(resolve(staging, 'SOURCE_REVISION'), `${revision}\n`);
		await writeFile(resolve(staging, 'SOURCE_URL'), `https://github.com/LeoWattenberg/Soundscaper/tree/${revision}\n`);
		await writeFile(resolve(staging, 'TARGET.json'), `${JSON.stringify(artifactTarget, null, 2)}\n`);
		const rustRoot = resolve(staging, 'licenses/rust');
		await mkdir(rustRoot, { recursive: true });
		for (const { directory, files } of notices) {
			for (const file of files) {
				const destination = resolve(rustRoot, directory, file.destination);
				await mkdir(dirname(destination), { recursive: true });
				await cp(file.source, destination);
			}
		}
		await writeFile(resolve(rustRoot, 'inventory.json'), `${JSON.stringify(inventories, null, 2)}\n`);
		await rm(artifact, { recursive: true, force: true });
		await rename(staging, artifact);
	} finally { await rm(staging, { recursive: true, force: true }); }
	return artifact;
}

/** @param {string} path @param {string} label @param {boolean} [directory] */
async function requireInput(path, label, directory = false) {
	let input;
	try { input = await stat(path); }
	catch (error) { throw new Error(`${label} is missing: ${path}`, { cause: error }); }
	if (directory ? !input.isDirectory() : !input.isFile() || input.size === 0) {
		throw new Error(`${label} is not a ${directory ? 'directory' : 'nonempty file'}: ${path}`);
	}
}

/** @param {string} hostDirectory @param {Execute} execute @param {string | undefined} target
 * @returns {Promise<{ metadata: CargoMetadata, rustTarget: string }>} */
async function loadMetadata(hostDirectory, execute, target) {
	const options = { cwd: hostDirectory };
	let rustTarget = target;
	if (rustTarget === undefined) {
		const version = await execute('rustc', ['-vV'], options);
		rustTarget = /^host: (\S+)\r?$/mu.exec(version)?.[1];
		if (!rustTarget) throw new Error('rustc did not report its current host target.');
	}
	return { rustTarget, metadata: JSON.parse(await execute('cargo', ['metadata', '--locked', '--format-version=1',
		'--features', 'custom-protocol', '--filter-platform', rustTarget], options)) };
}

/** @param {CargoMetadata} metadata @returns {CargoPackage[]} */
function resolvedDependencies(metadata) {
	if (!metadata.resolve?.root) throw new Error('Cargo metadata must resolve the locked prototype host.');
	const packages = new Map(metadata.packages.map((dependency) => [dependency.id, dependency]));
	const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
	/** @type {Set<string>} */
	const visited = new Set();
	const pending = [metadata.resolve.root];
	while (pending.length) {
		const id = pending.pop();
		if (id === undefined) break;
		if (visited.has(id)) continue;
		const node = nodes.get(id);
		if (!node || !packages.has(id)) throw new Error(`Missing Rust dependency in target metadata: ${id}`);
		visited.add(id);
		pending.push(...node.dependencies);
	}
	visited.delete(metadata.resolve.root);
	return metadata.packages.filter((dependency) => visited.has(dependency.id))
		.sort((first, second) => `${first.name}-${first.version}`.localeCompare(`${second.name}-${second.version}`, 'en'));
}

/** @param {CargoPackage} dependency @returns {Promise<NoticeFile[]>} */
async function dependencyNoticeFiles(dependency) {
	const root = dirname(dependency.manifest_path);
	const entries = await readdir(root, { withFileTypes: true });
	const files = new Map(entries.filter((entry) => entry.isFile() && /^(LICENSE|COPYING|NOTICE)/iu.test(entry.name))
		.map((entry) => [resolve(root, entry.name), entry.name]));
	if (dependency.license_file) {
		const source = resolve(root, dependency.license_file);
		const path = relative(root, source);
		const destination = path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
			? join('declared', basename(source)) : path;
		files.set(source, destination);
	}
	/** @type {NoticeFile[]} */
	const result = [];
	for (const [source, destination] of [...files].sort((first, second) => first[1] < second[1] ? -1 : first[1] > second[1] ? 1 : 0)) {
		await requireInput(source, `Required Rust notice for ${dependency.name}@${dependency.version}`);
		result.push({ source, destination });
	}
	return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	void Promise.resolve().then(() => {
		const args = process.argv.slice(2);
		if (args.some((arg) => !arg.startsWith('--target='))) {
			throw new Error('Usage: node prototypes/tauri/stage-artifact.mjs [--target=<Rust target>]');
		}
		return stagePrototypeArtifact({ root: ROOT, target: parsePrototypeArguments(['build', ...args]).target });
	}).then((artifact) => console.log(`Tauri prototype artifact: ${artifact}`))
		.catch((error) => { console.error(`Tauri prototype artifact: ${error.message}`); process.exitCode = 1; });
}
