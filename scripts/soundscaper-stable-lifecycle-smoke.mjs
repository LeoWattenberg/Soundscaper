#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	lstat, mkdir, mkdtemp, realpath, rm, stat, unlink, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
	basename, dirname, isAbsolute, join, resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	createDesktopScapeOpenFixture,
	createDesktopScapeOpenSmokeInvocation,
	parseDesktopScapeOpenSmokeOutput,
	runBoundedDesktopScapeOpenChild,
} from './lib/desktop-scape-open-smoke.mjs';
import {
	createDesktopScapeReopenSmokeInvocation,
	parseDesktopScapeReopenSmokeOutput,
} from './lib/desktop-scape-reopen-smoke.mjs';
import { readProductReleaseLinesSync } from './lib/product-release-lines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = Object.freeze(['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']);
const MAXIMUM_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export function createSoundscaperStableLifecyclePlan({
	target,
	candidatePackage,
	stablePackage,
	installRoot,
	releaseLines = readProductReleaseLinesSync(),
}) {
	if (!TARGETS.includes(target)) throw new TypeError('Stable lifecycle target is invalid.');
	const [platform, arch] = target.split('-');
	const root = absolutePath(installRoot, 'install root');
	const candidate = absolutePath(candidatePackage, 'candidate package');
	const stable = absolutePath(stablePackage, 'stable package');
	const line = releaseLines.products.soundscaper;
	const candidateName = packageName(line.candidate.version, platform, arch);
	const stableName = packageName(line.stable.version, platform, arch);
	if (basename(candidate) !== candidateName) {
		throw new Error(`Stable lifecycle candidate package name must be ${candidateName}.`);
	}
	if (basename(stable) !== stableName) {
		throw new Error(`Stable lifecycle stable package name must be ${stableName}.`);
	}
	const executable = platform === 'linux' ? '/usr/bin/soundscaper'
		: platform === 'mac'
			? resolve(root, 'Soundscaper.app/Contents/MacOS/Soundscaper')
			: resolve(root, 'Soundscaper.exe');
	return deepFreeze({
		schemaVersion: 1,
		productId: 'soundscaper',
		target,
		platform,
		arch,
		installRoot: root,
		executable,
		stages: [
			{ id: 'candidate-install-open', version: line.candidate.version, packagePath: candidate },
			{ id: 'stable-upgrade-reopen', version: line.stable.version, packagePath: stable },
			{ id: 'candidate-rollback-reopen', version: line.candidate.version, packagePath: candidate },
		],
	});
}

export async function runSoundscaperStableLifecycleSmoke({
	plan,
	outputPath,
	environment = process.env,
	runCommand = boundedCommand,
	runChild = runBoundedDesktopScapeOpenChild,
} = {}) {
	validateExecutionPlan(plan);
	const output = absolutePath(outputPath, 'evidence output');
	if (environment.GITHUB_ACTIONS !== 'true') {
		throw new Error('Stable installer lifecycle smoke may run only on an isolated GitHub Actions runner.');
	}
	if (typeof runCommand !== 'function' || typeof runChild !== 'function') {
		throw new TypeError('Stable lifecycle command dependencies are invalid.');
	}
	await absentPath(output, 'evidence output');
	await directDirectory(dirname(output), 'evidence output parent');
	const profileRoot = await mkdtemp(join(tmpdir(), 'soundscaper-stable-lifecycle-profile-'));
	let installed = false;
	let operationError;
	let evidence;
	try {
		const fixture = await createDesktopScapeOpenFixture(profileRoot);
		const token = randomBytes(16).toString('hex');
		const results = [];
		for (const [index, stage] of plan.stages.entries()) {
			await installStage(plan, stage, runCommand);
			installed = true;
			const executable = await installedExecutable(plan.executable);
			if (index === 0) {
				const invocation = createDesktopScapeOpenSmokeInvocation({
					arch: plan.arch,
					archiveByteLength: fixture.byteLength,
					outputRoot: plan.installRoot,
					platform: runtimePlatform(plan.platform),
					profileRoot,
					productId: 'soundscaper',
					scapePath: fixture.path,
					token,
				});
				const child = await runInvocation(executable, invocation, plan, environment, runChild);
				const result = parseDesktopScapeOpenSmokeOutput(child.stdout, invocation);
				await assertFixtureUnchanged(fixture);
				await unlink(fixture.path);
				results.push({ id: stage.id, version: stage.version, result });
				continue;
			}
			const invocation = createDesktopScapeReopenSmokeInvocation({
				arch: plan.arch,
				outputRoot: plan.installRoot,
				platform: runtimePlatform(plan.platform),
				profileRoot,
				productId: 'soundscaper',
				token,
			});
			const child = await runInvocation(executable, invocation, plan, environment, runChild);
			const result = parseDesktopScapeReopenSmokeOutput(child.stdout, invocation);
			assertSameProject(results[0].result, result);
			results.push({ id: stage.id, version: stage.version, result });
		}
		const packages = await Promise.all([...new Set(plan.stages.map(({ packagePath }) => packagePath))]
			.map(async (path) => ({
				name: basename(path),
				byteLength: Number((await lstat(path, { bigint: true })).size),
				sha256: await sha256File(path),
			})));
		evidence = {
			schemaVersion: 1,
			status: 'passed',
			productId: 'soundscaper',
			target: plan.target,
			sourceRevision: sourceRevision(environment.GITHUB_SHA),
			packages,
			stages: results,
		};
	} catch (error) {
		operationError = error;
	}
	let cleanupError;
	try {
		if (installed) await uninstall(plan, runCommand);
		await rm(profileRoot, { recursive: true, force: true });
		await rm(plan.installRoot, { recursive: true, force: true });
	} catch (error) {
		cleanupError = error;
	}
	if (operationError && cleanupError) {
		throw new AggregateError([operationError, cleanupError],
			'Stable lifecycle smoke and cleanup both failed.', { cause: operationError });
	}
	if (operationError) throw operationError;
	if (cleanupError) throw cleanupError;
	await writeFile(output, `${JSON.stringify(evidence, null, '\t')}\n`, { flag: 'wx', mode: 0o600 });
	return deepFreeze(evidence);
}

async function main(args = process.argv.slice(2)) {
	const options = parseArguments(args);
	const releaseLines = readProductReleaseLinesSync();
	const [platform, arch] = options.target.split('-');
	if (runtimePlatform(platform) !== process.platform) {
		throw new Error(`Stable lifecycle target ${options.target} does not match this runner.`);
	}
	const candidateName = packageName(releaseLines.products.soundscaper.candidate.version, platform, arch);
	const stableName = packageName(releaseLines.products.soundscaper.stable.version, platform, arch);
	const candidatePackage = await exactPackage(options.candidateRoot, candidateName);
	const stablePackage = await exactPackage(options.stableRoot, stableName);
	const installRoot = await mkdtemp(join(tmpdir(), 'soundscaper-stable-lifecycle-install-'));
	const plan = createSoundscaperStableLifecyclePlan({
		target: options.target,
		candidatePackage,
		stablePackage,
		installRoot,
		releaseLines,
	});
	await runSoundscaperStableLifecycleSmoke({ plan, outputPath: options.output });
	console.log(`Passed Soundscaper install, upgrade, and rollback smoke for ${plan.target}.`);
}

function parseArguments(args) {
	const parsed = {};
	for (const argument of args) {
		const match = /^--(candidate-root|stable-root|target|output)=(.+)$/u.exec(argument);
		if (!match || parsed[match[1]] !== undefined) {
			throw new TypeError(`Unknown or duplicate stable lifecycle option ${argument}.`);
		}
		parsed[match[1]] = match[2];
	}
	for (const name of ['candidate-root', 'stable-root', 'target', 'output']) {
		if (parsed[name] === undefined) throw new TypeError(`--${name}=... is required.`);
	}
	if (!TARGETS.includes(parsed.target)) throw new TypeError('Stable lifecycle target is invalid.');
	return {
		candidateRoot: absolutePath(parsed['candidate-root'], 'candidate package root'),
		stableRoot: absolutePath(parsed['stable-root'], 'stable package root'),
		target: parsed.target,
		output: absolutePath(parsed.output, 'evidence output'),
	};
}

async function exactPackage(root, name) {
	await directDirectory(root, 'package root');
	const path = resolve(root, name);
	if (dirname(path) !== root) throw new Error('Stable lifecycle package name escaped its root.');
	const entry = await lstat(path);
	if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 1 || entry.size > 2 * 1024 * 1024 * 1024) {
		throw new Error(`Stable lifecycle package ${name} is not one bounded regular file.`);
	}
	return path;
}

async function installStage(plan, stage, runCommand) {
	if (plan.platform === 'linux') {
		runCommand('sudo', ['dpkg', '--install', '--force-downgrade', stage.packagePath], stage.id);
		return;
	}
	if (plan.platform === 'win') {
		runCommand(stage.packagePath, ['/S', `/D=${plan.installRoot}`], stage.id);
		return;
	}
	const mountRoot = resolve(plan.installRoot, `mount-${stage.id}`);
	await mkdir(mountRoot, { recursive: false, mode: 0o700 });
	let mounted = false;
	try {
		runCommand('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountRoot,
			stage.packagePath], `${stage.id} mount`);
		mounted = true;
		const source = resolve(mountRoot, 'Soundscaper.app');
		await directDirectory(source, 'mounted application');
		const destination = resolve(plan.installRoot, 'Soundscaper.app');
		await rm(destination, { recursive: true, force: true });
		runCommand('ditto', [source, destination], stage.id);
	} finally {
		if (mounted) runCommand('hdiutil', ['detach', mountRoot], `${stage.id} detach`);
		await rm(mountRoot, { recursive: true, force: true });
	}
}

async function uninstall(plan, runCommand) {
	if (plan.platform === 'linux') {
		runCommand('sudo', ['dpkg', '--remove', 'soundscaper'], 'lifecycle cleanup');
		return;
	}
	if (plan.platform === 'win') {
		const uninstaller = resolve(plan.installRoot, 'Uninstall Soundscaper.exe');
		await regularExecutable(uninstaller, 'installed uninstaller');
		runCommand(uninstaller, ['/S'], 'lifecycle cleanup');
	}
}

async function runInvocation(executable, invocation, plan, environment, runChild) {
	const useXvfb = plan.platform === 'linux' && environment.SOUNDSCAPER_SMOKE_XVFB === 'true';
	const command = useXvfb ? 'xvfb-run' : executable;
	const args = useXvfb ? ['-a', executable, ...invocation.appArguments] : invocation.appArguments;
	const childEnvironment = { ...environment };
	delete childEnvironment.ELECTRON_RUN_AS_NODE;
	delete childEnvironment.SCAPE_PRODUCT;
	const child = await runChild(command, args, { cwd: ROOT, environment: childEnvironment });
	if (child.code !== 0) {
		throw new Error(`Stable lifecycle application smoke exited with code ${String(child.code)}.\n${child.stderr}`);
	}
	return child;
}

function boundedCommand(command, args, label) {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		shell: false,
		maxBuffer: MAXIMUM_COMMAND_OUTPUT_BYTES,
		timeout: COMMAND_TIMEOUT_MS,
		windowsHide: true,
	});
	if (result.error !== undefined || result.signal !== null || result.status !== 0) {
		throw new Error(`Stable lifecycle ${label} failed.\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
	}
}

async function assertFixtureUnchanged(fixture) {
	const metadata = await stat(fixture.path);
	if (!metadata.isFile() || metadata.size !== fixture.byteLength
		|| await sha256File(fixture.path) !== fixture.sha256) {
		throw new Error('Stable lifecycle candidate open changed its fixture archive.');
	}
}

function assertSameProject(open, reopened) {
	if (open.productId !== reopened.productId || open.token !== reopened.token
		|| JSON.stringify(open.project) !== JSON.stringify(reopened.project)) {
		throw new Error('Stable lifecycle upgrade or rollback did not preserve the opened project.');
	}
}

async function installedExecutable(path) {
	const canonical = await realpath(path);
	await regularExecutable(canonical, 'installed application executable');
	return canonical;
}

async function regularExecutable(path, label) {
	const entry = await lstat(path);
	if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) === 0) {
		throw new Error(`Stable lifecycle ${label} is invalid.`);
	}
}

async function directDirectory(path, label) {
	const entry = await lstat(path);
	if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error(`Stable lifecycle ${label} is not one canonical directory.`);
	}
}

async function absentPath(path, label) {
	try {
		await lstat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') return;
		throw error;
	}
	throw new Error(`Stable lifecycle ${label} already exists.`);
}

function validateExecutionPlan(plan) {
	if (!plan || plan.schemaVersion !== 1 || plan.productId !== 'soundscaper'
		|| !TARGETS.includes(plan.target) || !Object.isFrozen(plan)
		|| !Array.isArray(plan.stages) || plan.stages.length !== 3
		|| dirname(plan.installRoot) !== resolve(tmpdir())
		|| !basename(plan.installRoot).startsWith('soundscaper-stable-lifecycle-install-')) {
		throw new TypeError('Stable lifecycle execution plan is invalid.');
	}
}

function packageName(version, platform, arch) {
	const extension = platform === 'linux' ? 'deb' : platform === 'mac' ? 'dmg' : 'exe';
	const packageTarget = platform === 'linux' && arch === 'x64' ? 'linux-amd64'
		: `${platform}-${arch}`;
	return `Soundscaper-${version}-${packageTarget}.${extension}`;
}

function runtimePlatform(platform) {
	return platform === 'win' ? 'win32' : platform === 'mac' ? 'darwin' : 'linux';
}

function sourceRevision(value) {
	if (typeof value !== 'string' || !/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(value)) {
		throw new Error('Stable lifecycle source revision is unavailable.');
	}
	return value;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || value.length === 0 || value.includes('\0')
		|| !isAbsolute(value) || resolve(value) !== value) {
		throw new TypeError(`Stable lifecycle ${label} must be an absolute normalized path.`);
	}
	return value;
}

function sha256File(path) {
	return new Promise((resolvePromise, reject) => {
		const hash = createHash('sha256');
		const stream = createReadStream(path);
		stream.on('error', reject);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolvePromise(hash.digest('hex')));
	});
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

function isMain() {
	return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMain()) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
