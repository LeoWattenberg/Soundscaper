/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { extractFile, listPackage, statFile } from '@electron/asar';

import { assistanceNativeRuntimeStageSummary } from '../../desktop/assistance-native-runtime-payload.mjs';
import { validateAssistanceRuntimeFamilyManifestV1 } from '../../desktop/assistance-runtime-family-manifest.ts';
import { assertE2EHtmlExecutablePolicy } from './e2e-dynamic-code-audit.mjs';
import {
	collectPackagedExecutableResourceFiles,
	packagedExecutableResourceIdentity,
} from './packaged-executable-resource-identity.mjs';

const SCRIPT_PATTERN = /\.(?:c|m)?js$/u;
const HTML_PATTERN = /\.html?$/u;
const SOURCE_MAP_PATTERN = /\.map$/u;
const WASM_PATTERN = /\.wasm$/u;

/**
 * Preserve the exact JavaScript, renderer maps, and executable Wasm behind a packaged product.
 *
 * The next product preparation destroys `.desktop-build`, while the installed
 * nightly runner writes coverage somewhere else again. Keeping content-addressed
 * evidence beside each packaged product gives the importer a portable source
 * for URL normalization, its JavaScript denominator, and explicit Wasm evidence.
 *
 * @param {{ buildRoot: string, productId: string, productOutput: string, sourceRevision: string }} options
 */
export async function preserveDesktopNightlyProductCoverageEvidence({
	buildRoot,
	productId,
	productOutput,
	sourceRevision,
}) {
	if (!['soundscaper', 'framescaper'].includes(productId)) {
		throw new TypeError('Desktop nightly coverage evidence needs a known product.');
	}
	const build = requiredAbsolutePath(buildRoot, 'build root');
	const output = requiredAbsolutePath(productOutput, 'product output');
	if (!/^[0-9a-f]{40}$/u.test(sourceRevision ?? '')) {
		throw new TypeError('Desktop nightly coverage evidence needs a full source revision.');
	}
	const evidenceRoot = join(output, 'e2e-coverage');
	const applicationRoot = join(build, 'app');
	const rendererRoot = join(build, 'renderer');
	const sourceMapRoot = join(build, 'renderer-source-maps');
	const [applicationDocuments, applicationScripts, rendererDocuments, rendererScripts, rendererWebAssembly, sourceMaps] = await Promise.all([
		filesMatching(applicationRoot, HTML_PATTERN, 'packaged application documents'),
		filesMatching(applicationRoot, SCRIPT_PATTERN, 'packaged application scripts'),
		filesMatching(rendererRoot, HTML_PATTERN, 'packaged renderer documents'),
		filesMatching(rendererRoot, SCRIPT_PATTERN, 'packaged renderer scripts'),
		filesMatching(rendererRoot, WASM_PATTERN, 'packaged renderer WebAssembly'),
		filesMatching(sourceMapRoot, SOURCE_MAP_PATTERN, 'renderer source maps'),
	]);
	if (sourceMaps.length === 0) {
		throw new Error('Desktop nightly coverage evidence requires renderer source maps.');
	}
	const appAsar = await uniquePackagedAppAsar(output);
	const resourcesRoot = dirname(appAsar);
	const archiveBytes = await readFile(appAsar);
	assertSameNames(
		archiveNamesMatching(appAsar, SCRIPT_PATTERN),
		applicationScripts,
		'Desktop nightly coverage app.asar executable scripts differ from the staged application.',
	);
	assertSameNames(
		archiveNamesMatching(appAsar, HTML_PATTERN),
		applicationDocuments,
		'Desktop nightly coverage app.asar documents differ from the staged application.',
	);
	const stage = await readStageManifest(build, productId);
	const excludedRuntimeScripts = approvedRuntimeScripts({ appAsar, stage });
	const stagedRuntimeResources = (await collectOptionalRuntimeResources(join(build, 'runtime')))
		.map((file) => Object.freeze({ ...file, path: `runtime/${file.path}` }));
	const stagedRuntimeScripts = stagedRuntimeResources.filter(({ path }) => SCRIPT_PATTERN.test(path));
	const stagedRuntimeDocuments = stagedRuntimeResources.filter(({ path }) => HTML_PATTERN.test(path));
	const stagedRuntimeWebAssembly = stagedRuntimeResources.filter(({ path }) => WASM_PATTERN.test(path));
	assertApprovedRuntimeScripts(stagedRuntimeScripts, excludedRuntimeScripts);

	await rm(evidenceRoot, { recursive: true, force: true });
	await mkdir(evidenceRoot, { recursive: true });
	const documents = [];
	const htmlResources = [];
	const scripts = [];
	const webAssemblyResources = [];
	const rendererExecutableResources = [];
	for (const name of applicationScripts) {
		const bytes = Buffer.from(extractFile(appAsar, name));
		await assertSameBytes(join(applicationRoot, name), bytes, `packaged app.asar/${name}`);
		scripts.push(await preserveFile({
			artifactPath: `app/${name}`,
			bytes,
			evidenceRoot,
			packagedPath: `app.asar/${name}`,
			realm: preloadScript(name) ? 'preload' : 'main',
		}));
	}
	for (const name of applicationDocuments) {
		const bytes = Buffer.from(extractFile(appAsar, name));
		await assertSameBytes(join(applicationRoot, name), bytes, `packaged app.asar/${name}`);
		htmlResources.push({ artifactPath: `app/${name}`, source: bytes.toString('utf8') });
		documents.push(await preserveFile({
			artifactPath: `app/${name}`,
			bytes,
			evidenceRoot,
			packagedPath: `app.asar/${name}`,
		}));
	}
	for (const name of rendererScripts) {
		const packagedRenderer = join(resourcesRoot, 'renderer', name);
		const bytes = await readFile(packagedRenderer);
		await assertSameBytes(join(rendererRoot, name), bytes, `packaged renderer/${name}`);
		rendererExecutableResources.push(Object.freeze({
			path: `renderer/${name}`,
			...fileRecord(bytes),
		}));
		scripts.push(await preserveFile({
			artifactPath: `renderer/${name}`,
			bytes,
			evidenceRoot,
			packagedPath: `renderer/${name}`,
			realm: 'renderer',
		}));
	}
	for (const name of rendererDocuments) {
		const packagedRenderer = join(resourcesRoot, 'renderer', name);
		const bytes = await readFile(packagedRenderer);
		await assertSameBytes(join(rendererRoot, name), bytes, `packaged renderer/${name}`);
		rendererExecutableResources.push(Object.freeze({
			path: `renderer/${name}`,
			...fileRecord(bytes),
		}));
		htmlResources.push({ artifactPath: `renderer/${name}`, source: bytes.toString('utf8') });
		documents.push(await preserveFile({
			artifactPath: `renderer/${name}`,
			bytes,
			evidenceRoot,
			packagedPath: `renderer/${name}`,
		}));
	}
	for (const name of rendererWebAssembly) {
		const packagedPath = `renderer/${name}`;
		const bytes = await readFile(join(resourcesRoot, packagedPath));
		await assertSameBytes(join(rendererRoot, name), bytes, `packaged ${packagedPath}`);
		rendererExecutableResources.push(Object.freeze({ path: packagedPath, ...fileRecord(bytes) }));
		webAssemblyResources.push(await preserveFile({
			artifactPath: `webassembly/${packagedPath}`,
			bytes,
			evidenceRoot,
			packagedPath,
		}));
	}
	for (const record of stagedRuntimeDocuments) {
		const name = record.path.slice('runtime/'.length);
		const bytes = await readFile(join(resourcesRoot, record.path));
		await assertSameBytes(join(build, record.path), bytes, `packaged runtime/${name}`);
		htmlResources.push({ artifactPath: record.path, source: bytes.toString('utf8') });
		documents.push(await preserveFile({
			artifactPath: record.path,
			bytes,
			evidenceRoot,
			packagedPath: record.path,
		}));
	}
	for (const record of stagedRuntimeWebAssembly) {
		const bytes = await readFile(join(resourcesRoot, record.path));
		await assertSameBytes(join(build, record.path), bytes, `packaged ${record.path}`);
		webAssemblyResources.push(await preserveFile({
			artifactPath: `webassembly/${record.path}`,
			bytes,
			evidenceRoot,
			packagedPath: record.path,
		}));
	}
	assertE2EHtmlExecutablePolicy(htmlResources, { label: `${productId} packaged HTML` });
	const executableResources = await collectPackagedExecutableResourceFiles(resourcesRoot);
	assertSameRecords(
		executableResources,
		[
			...rendererExecutableResources,
			...excludedRuntimeScripts,
			...stagedRuntimeDocuments,
			...stagedRuntimeWebAssembly,
		].sort(comparePath),
		'Desktop nightly coverage executable resources differ from the staged renderer and runtime.',
	);
	const preservedMaps = [];
	for (const name of sourceMaps) {
		preservedMaps.push(await preserveFile({
			artifactPath: `renderer-source-maps/${name}`,
			evidenceRoot,
			sourcePath: join(sourceMapRoot, name),
		}));
	}
	const manifest = {
		schemaVersion: 4,
		kind: 'soundscaper-e2e-product-build-evidence',
		productId,
		sourceRevision,
		packageArchive: fileRecord(archiveBytes),
		executableResources: packagedExecutableResourceIdentity(executableResources),
		excludedRuntimeScripts,
		documents,
		scripts,
		sourceMaps: preservedMaps,
		webAssemblyResources,
	};
	const target = join(evidenceRoot, 'manifest.json');
	const temporary = join(evidenceRoot, '.manifest.json.tmp');
	await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
	await rename(temporary, target);
	return Object.freeze(manifest);
}

async function collectOptionalRuntimeResources(runtimeRoot) {
	try {
		return await collectPackagedExecutableResourceFiles(runtimeRoot);
	} catch (error) {
		if (error?.code === 'ENOENT') return Object.freeze([]);
		throw error;
	}
}

function archiveNamesMatching(appAsar, pattern) {
	const names = [];
	for (const archivePath of listPackage(appAsar)) {
		const name = archivePath.replace(/^[/\\]/u, '').replaceAll('\\', '/');
		const metadata = statFile(appAsar, name);
		if ('files' in metadata) continue;
		if ('link' in metadata) {
			throw new Error(`Desktop nightly coverage app.asar contains an executable link at ${name}.`);
		}
		if (pattern.test(name)) names.push(name);
	}
	return names.sort();
}

async function readStageManifest(buildRoot, productId) {
	let value;
	try {
		value = JSON.parse(await readFile(join(buildRoot, 'stage-manifest.json'), 'utf8'));
	} catch (error) {
		throw new Error('Desktop nightly coverage needs the exact desktop stage manifest.', { cause: error });
	}
	if (!plainRecord(value) || value.schemaVersion !== 1 || value.productId !== productId
		|| !plainRecord(value.target) || !['linux', 'mac', 'win'].includes(value.target.platform)
		|| !['x64', 'arm64'].includes(value.target.arch)) {
		throw new Error('Desktop nightly coverage has invalid desktop stage identity.');
	}
	return value;
}

function approvedRuntimeScripts({ appAsar, stage }) {
	const targetId = `${stage.target.platform}-${stage.target.arch}`;
	const approved = [];
	if (stage.assistanceNativeRuntime !== undefined) {
		const manifest = extractedJson(appAsar, 'config/assistance-native-runtime-manifest.json');
		const summary = assistanceNativeRuntimeStageSummary(manifest, targetId);
		if (JSON.stringify(summary) !== JSON.stringify(stage.assistanceNativeRuntime)) {
			throw new Error('Desktop nightly coverage assistance runtime differs from its stage authority.');
		}
		for (const [name, descriptor] of Object.entries(summary.payload?.files ?? {})) {
			if (SCRIPT_PATTERN.test(name)) approved.push(Object.freeze({
				path: `runtime/${summary.payload.root}/${name}`,
				byteLength: descriptor.byteLength,
				sha256: descriptor.sha256,
			}));
		}
	}
	if (stage.assistanceRuntimeFamilies !== undefined) {
		const name = 'config/assistance-runtime-family-supply-candidates.json';
		const bytes = Buffer.from(extractFile(appAsar, name));
		const reference = stage.assistanceRuntimeFamilies;
		if (!plainRecord(reference) || reference.targetId !== targetId
			|| !sameFileRecord(reference.manifest, fileRecord(bytes))) {
			throw new Error('Desktop nightly coverage runtime-family manifest differs from its stage authority.');
		}
		const register = parseJson(bytes, name);
		if (!plainRecord(register.manifests)) {
			throw new Error('Desktop nightly coverage runtime-family manifest inventory is invalid.');
		}
		for (const candidate of Object.values(register.manifests)) {
			const manifest = validateAssistanceRuntimeFamilyManifestV1(candidate);
			const target = manifest.targets.find(({ id }) => id === targetId);
			if (target?.status !== 'authenticated') continue;
			for (const descriptor of target.files) {
				if (SCRIPT_PATTERN.test(descriptor.path)) approved.push(Object.freeze({
					path: `runtime/${manifest.runtimePrefix}/${targetId}/${descriptor.path}`,
					byteLength: descriptor.byteLength,
					sha256: descriptor.sha256,
				}));
			}
		}
	}
	approved.sort(comparePath);
	if (new Set(approved.map(({ path }) => path)).size !== approved.length) {
		throw new Error('Desktop nightly coverage runtime authorities repeat an executable script.');
	}
	return approved;
}

function assertApprovedRuntimeScripts(staged, approved) {
	const authority = new Map(approved.map((file) => [file.path, file]));
	for (const file of staged) {
		const expected = authority.get(file.path);
		if (!expected) {
			throw new Error(`Desktop nightly coverage runtime script is not an approved third-party exclusion: ${file.path}.`);
		}
		if (!sameFileRecord(file, expected)) {
			throw new Error(`Desktop nightly coverage runtime script differs from its approved authority: ${file.path}.`);
		}
	}
	assertSameRecords(
		staged,
		approved,
		'Desktop nightly coverage approved runtime script inventory is incomplete.',
	);
}

function extractedJson(appAsar, name) {
	return parseJson(Buffer.from(extractFile(appAsar, name)), name);
}

function parseJson(bytes, name) {
	try { return JSON.parse(bytes.toString('utf8')); } catch (error) {
		throw new Error(`Desktop nightly coverage ${name} is not valid JSON.`, { cause: error });
	}
}

function assertSameNames(actual, expected, message) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function assertSameRecords(actual, expected, message) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(message);
}

function sameFileRecord(left, right) {
	return plainRecord(left) && plainRecord(right)
		&& left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

function plainRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function comparePath(left, right) {
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

async function preserveFile({
	artifactPath,
	bytes,
	evidenceRoot,
	packagedPath,
	realm,
	sourcePath,
}) {
	const contents = bytes ?? await readFile(sourcePath);
	const target = join(evidenceRoot, artifactPath);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, contents, { flag: 'wx' });
	return Object.freeze({
		...(realm === undefined ? {} : { realm }),
		...(packagedPath === undefined ? {} : { packagedPath }),
		artifactPath,
		...fileRecord(contents),
	});
}

async function uniquePackagedAppAsar(productOutput) {
	const candidates = (await walkFiles(productOutput))
		.filter((name) => /(?:^|\/)resources\/app\.asar$/u.test(name));
	if (candidates.length !== 1) {
		throw new Error('Desktop nightly coverage evidence needs one finished packaged app.asar.');
	}
	return join(productOutput, candidates[0]);
}

async function assertSameBytes(sourcePath, packagedBytes, label) {
	const staged = await readFile(sourcePath);
	if (!staged.equals(packagedBytes)) {
		throw new Error(`Desktop nightly coverage ${label} differs from the staged executable.`);
	}
}

function fileRecord(bytes) {
	return Object.freeze({
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	});
}

async function filesMatching(root, pattern, label) {
	let files;
	try {
		files = await walkFiles(root);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new Error(`Desktop nightly coverage ${label} are missing.`, { cause: error });
		throw error;
	}
	return files.filter((name) => pattern.test(name));
}

async function walkFiles(root, directory = root) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...await walkFiles(root, path));
		else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
	}
	return files.sort();
}

function preloadScript(name) {
	return /(?:^|[-/])preload\.(?:c|m)?js$/u.test(name);
}

function requiredAbsolutePath(value, label) {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new TypeError(`Desktop nightly coverage ${label} is required.`);
	}
	return resolve(value);
}
