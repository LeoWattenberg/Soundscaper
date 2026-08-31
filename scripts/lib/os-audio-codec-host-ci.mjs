/* SPDX-License-Identifier: AGPL-3.0-only */

/** Target-native CI acquisition and build handoff for the codec-only OS host. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
	lstat, mkdir, mkdtemp, open, readdir, realpath, rm,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { collectExtractedSourceTree } from '../../native/framescaper-media-host/build/source-authentication.mjs';
import { prepareDesktopOsAudioCodecNativeRelease } from './desktop-os-audio-codec-native-staging.mjs';

export const ELECTRON_HEADERS_CI_SOURCE = deepFreeze({
	version: '43.1.1',
	requestUrl: 'https://electronjs.org/headers/v43.1.1/node-v43.1.1-headers.tar.gz',
	redirectUrl: 'https://artifacts.electronjs.org/headers/dist/v43.1.1/node-v43.1.1-headers.tar.gz',
	archive: {
		fileName: 'node-v43.1.1-headers.tar.gz', byteLength: 344_774,
		sha256: 'b1112989ad4c4807a6bf59bfc96ce8d0f0b16962efe9818fa768e5908cc24d21',
	},
	extractedTree: {
		algorithm: 'framescaper-portable-source-tree-sha256-v1', fileCount: 124,
		sha256: '9eae0a9eb7630b1b53f98e4b7c69951aee2a159ff1f564eeed06b78580de62eb',
	},
});

const BUILD_SCRIPT = 'scripts/build-os-audio-codec-host.mjs';
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAXIMUM_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_GITHUB_ENVIRONMENT_BYTES = 1024 * 1024;

export function resolveOsAudioCodecHostCiTarget({
	desktopPlatform, desktopArch, runnerOs, runnerArch,
}) {
	const key = `${String(desktopPlatform)}/${String(desktopArch)}/${String(runnerOs)}/${String(runnerArch)}`;
	const target = Object.freeze({
		'win/x64/Windows/X64': 'win-x64',
		'win/arm64/Windows/ARM64': 'win-arm64',
		'mac/arm64/macOS/ARM64': 'mac-arm64',
	})[key];
	if (target === undefined) {
		throw new TypeError(`OS audio codec CI requires one target-native Windows or macOS ARM64 runner; got ${key}.`);
	}
	return target;
}

export async function runOsAudioCodecHostCi(options, dependencies = {}) {
	const target = resolveOsAudioCodecHostCiTarget(options);
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	const runnerTemp = await canonicalDirectory(options?.runnerTemp, 'RUNNER_TEMP');
	const githubEnvironmentPath = await canonicalFile(
		options?.githubEnvironmentPath, 'GITHUB_ENV',
	);
	assertContained(runnerTemp, githubEnvironmentPath, 'GITHUB_ENV');
	const workspace = await mkdtemp(join(runnerTemp, 'soundscaper-os-audio-codec-host-'));
	const plan = deepFreeze({
		target, repositoryRoot, runnerTemp, githubEnvironmentPath, workspace,
		archivePath: join(workspace, ELECTRON_HEADERS_CI_SOURCE.archive.fileName),
		extractionRoot: join(workspace, 'electron-headers'),
		headersRoot: join(workspace, 'electron-headers/node_headers'),
		outputRoot: join(workspace, 'host-build'),
		resultPath: join(workspace, 'os-audio-codec-host-build-result.json'),
	});
	const download = dependencies.download ?? downloadPinnedElectronHeaders;
	const extract = dependencies.extract ?? extractPinnedElectronHeaders;
	const runBuild = dependencies.runBuild ?? executeBuildCommand;
	const verifyResult = dependencies.verifyResult ?? verifyCanonicalBuildResult;
	await download({ destination: plan.archivePath });
	await extract({
		archivePath: plan.archivePath,
		extractionRoot: plan.extractionRoot,
		headersRoot: plan.headersRoot,
	});
	const macosSdkPath = target === 'mac-arm64'
		? await (dependencies.resolveMacosSdk ?? resolveMacosSdk)() : null;
	const arguments_ = [
		resolve(repositoryRoot, BUILD_SCRIPT),
		`--root=${repositoryRoot}`,
		`--target=${target}`,
		`--headers-archive=${plan.archivePath}`,
		`--headers-root=${plan.headersRoot}`,
		`--output=${plan.outputRoot}`,
		`--result=${plan.resultPath}`,
		...(macosSdkPath === null ? [] : [
			`--macos-sdk=${macosSdkPath}`,
		]),
	];
	await runBuild({ command: process.execPath, arguments: arguments_, plan });
	await verifyResult({
		resultPath: plan.resultPath,
		repositoryRoot,
		target,
	});
	await publishBuildEnvironment({
		githubEnvironmentPath, resultPath: plan.resultPath,
	});
	return deepFreeze({ target, workspace, resultPath: plan.resultPath });
}

export async function downloadPinnedElectronHeaders({
	destination, fetchImpl = globalThis.fetch,
}) {
	const path = absentPath(destination, 'Electron headers archive');
	if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
	const response = await fetchImpl(ELECTRON_HEADERS_CI_SOURCE.requestUrl, {
		redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	});
	const expected = ELECTRON_HEADERS_CI_SOURCE.archive;
	if (!response?.ok || response.status !== 200
		|| response.url !== ELECTRON_HEADERS_CI_SOURCE.redirectUrl
		|| response.headers?.get('content-length') !== String(expected.byteLength)
		|| response.body === null || response.body === undefined) {
		throw new Error('Electron headers download did not match its exact URL and length admission.');
	}
	let handle;
	try {
		handle = await open(path, 'wx', 0o600);
		const hash = createHash('sha256');
		let byteLength = 0;
		for await (const value of response.body) {
			const bytes = Buffer.from(value);
			byteLength += bytes.byteLength;
			if (byteLength > expected.byteLength) {
				throw new Error('Electron headers download exceeded its exact byte length.');
			}
			hash.update(bytes);
			await writeAll(handle, bytes);
		}
		await handle.sync();
		if (byteLength !== expected.byteLength || hash.digest('hex') !== expected.sha256) {
			throw new Error('Electron headers download failed its exact digest admission.');
		}
	} catch (error) {
		await handle?.close().catch(() => {});
		handle = undefined;
		await rm(path, { force: true });
		throw error;
	} finally {
		await handle?.close();
	}
	await canonicalFile(path, 'Electron headers archive');
	return deepFreeze({ path, byteLength: expected.byteLength, sha256: expected.sha256 });
}

export function authenticateElectronHeadersTree(headersRoot) {
	const actual = collectExtractedSourceTree(headersRoot);
	const expected = ELECTRON_HEADERS_CI_SOURCE.extractedTree;
	if (actual.algorithm !== expected.algorithm || actual.fileCount !== expected.fileCount
		|| actual.sha256 !== expected.sha256) {
		throw new Error('Electron headers extracted tree failed its exact identity admission.');
	}
	return deepFreeze({
		algorithm: actual.algorithm, fileCount: actual.fileCount, sha256: actual.sha256,
	});
}

async function extractPinnedElectronHeaders({ archivePath, extractionRoot, headersRoot }) {
	await canonicalFile(archivePath, 'Electron headers archive');
	await mkdir(extractionRoot, { recursive: false, mode: 0o700 });
	const outcome = spawnSync('tar', ['-xzf', archivePath, '-C', extractionRoot], {
		encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_COMMAND_OUTPUT_BYTES,
	});
	assertSuccessful(outcome, 'Electron headers extraction');
	const entries = await readdir(extractionRoot, { withFileTypes: true });
	if (entries.length !== 1 || entries[0].name !== 'node_headers'
		|| !entries[0].isDirectory() || entries[0].isSymbolicLink()) {
		throw new Error('Electron headers archive did not extract one exact node_headers root.');
	}
	return authenticateElectronHeadersTree(headersRoot);
}

async function resolveMacosSdk() {
	const outcome = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
		encoding: 'utf8', shell: false, maxBuffer: 16 * 1024,
	});
	assertSuccessful(outcome, 'macOS SDK resolution');
	const path = String(outcome.stdout).trim();
	if (path.includes('\n') || path.includes('\r')) throw new Error('xcrun returned an invalid macOS SDK path.');
	return canonicalMacosSdkRoot(path);
}

/**
 * Xcode ships MacOSX.sdk as a symbolic alias for the versioned SDK directory it
 * currently carries, and xcrun reports that alias. Follow it to the directory it
 * names, then hold the result to the same canonical rule as every other input,
 * so the build plan records one exact SDK rather than a moving alias.
 */
export async function canonicalMacosSdkRoot(value) {
	const alias = absoluteNormalizedPath(value, 'macOS SDK root');
	return canonicalDirectory(await realpath(alias), 'macOS SDK root');
}

function executeBuildCommand({ command, arguments: arguments_, plan }) {
	const outcome = spawnSync(command, arguments_, {
		cwd: plan.repositoryRoot, env: process.env, shell: false, stdio: 'inherit',
	});
	assertSuccessful(outcome, 'OS audio codec host build');
}

async function verifyCanonicalBuildResult({ resultPath, repositoryRoot, target }) {
	const release = await prepareDesktopOsAudioCodecNativeRelease({
		buildResultPath: resultPath,
		repositoryRoot,
		target,
		required: true,
	});
	if (release === null) throw new Error('OS audio codec build result did not produce a verified release.');
}

async function publishBuildEnvironment({ githubEnvironmentPath, resultPath }) {
	if (resultPath.includes('\n') || resultPath.includes('\r')) {
		throw new Error('OS audio codec build-result path cannot be published to GITHUB_ENV.');
	}
	const path = await canonicalFile(githubEnvironmentPath, 'GITHUB_ENV');
	const before = await lstat(path);
	const bytes = Buffer.from(
		`SOUNDSCAPER_OS_AUDIO_CODEC_BUILD_RESULT=${resultPath}\n`
		+ 'SOUNDSCAPER_REQUIRE_OS_AUDIO_CODEC_NATIVE=true\n',
	);
	if (!Number.isSafeInteger(before.size) || before.size < 0
		|| bytes.byteLength > MAXIMUM_GITHUB_ENVIRONMENT_BYTES - before.size) {
		throw new Error('GITHUB_ENV plus the OS audio codec handoff exceeds its bounded size.');
	}
	const handle = await open(path,
		constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0 && opened.ino !== 0
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error('GITHUB_ENV changed while opening.');
		}
		await writeAll(handle, bytes);
		await handle.sync();
	} finally { await handle.close(); }
}

async function writeAll(handle, bytes) {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
		if (bytesWritten < 1) throw new Error('Bounded CI file write made no progress.');
		offset += bytesWritten;
	}
}

async function canonicalDirectory(value, label) {
	const path = absoluteNormalizedPath(value, label);
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new Error(`${label} must be one canonical non-symbolic directory.`);
	}
	return realpath(path);
}

async function canonicalFile(value, label) {
	const path = absoluteNormalizedPath(value, label);
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error(`${label} must be one canonical non-symbolic regular file.`);
	}
	return realpath(path);
}

function absentPath(value, label) {
	const path = absoluteNormalizedPath(value, label);
	return path;
}

function absoluteNormalizedPath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0') || Buffer.byteLength(value) > 4_096) {
		throw new TypeError(`${label} must be one absolute normalized path.`);
	}
	return value;
}

function assertContained(root, path, label) {
	const child = relative(root, path);
	if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new Error(`${label} must remain below RUNNER_TEMP.`);
	}
}

function assertSuccessful(outcome, label) {
	if (outcome?.error !== undefined || outcome?.signal !== null || outcome?.status !== 0) {
		const detail = String(outcome?.stderr || outcome?.stdout || outcome?.error?.message || 'unknown error');
		throw new Error(`${label} failed: ${detail.slice(0, 4_096)}`);
	}
}

function deepFreeze(value) {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
