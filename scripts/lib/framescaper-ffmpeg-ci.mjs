/* SPDX-License-Identifier: AGPL-3.0-only */

/** Digest- and tree-authenticated FFmpeg provisioning for media-host CI builds. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
	lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
	collectExtractedSourceTree,
} from '../../native/framescaper-media-host/build/source-authentication.mjs';
import {
	readFramescaperMediaHostSourceManifest,
} from './framescaper-media-host-build.mjs';

export const FRAMESCAPER_FFMPEG_CI_ADMISSION = Object.freeze({
	version: '9.0.1',
	url: 'https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz',
	archive: Object.freeze({
		fileName: 'ffmpeg-9.0.1.tar.xz',
		byteLength: 12_036_420,
		sha256: 'cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635',
	}),
	extractedTree: Object.freeze({
		algorithm: 'framescaper-portable-source-tree-sha256-v1',
		fileCount: 10_397,
		sha256: 'dc709cc7d80424f45aab44ac94e59f7c8669fe18b877e9e5f1319006bfa622b4',
	}),
});

const DOWNLOAD_TIMEOUT_MS = 300_000;
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_ENVIRONMENT_BYTES = 1024 * 1024;

export async function runFramescaperFfmpegCiProvisioning(options, dependencies = {}) {
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	const runnerTemp = await canonicalDirectory(options?.runnerTemp, 'RUNNER_TEMP');
	const githubEnvironmentPath = await canonicalFilePath(options?.githubEnvironmentPath, 'GITHUB_ENV');
	assertContained(runnerTemp, githubEnvironmentPath, 'GITHUB_ENV');
	assertAdmission(repositoryRoot);
	const workspace = await mkdtemp(join(runnerTemp, 'soundscaper-framescaper-ffmpeg-'));
	const archivePath = join(workspace, FRAMESCAPER_FFMPEG_CI_ADMISSION.archive.fileName);
	const sourceRoot = join(workspace, 'source');
	const download = dependencies.download ?? downloadPinnedFramescaperFfmpeg;
	const extract = dependencies.extract ?? extractPinnedFramescaperFfmpeg;
	const collectTree = dependencies.collectTree ?? collectExtractedSourceTree;
	try {
		await download({ destination: archivePath, admission: FRAMESCAPER_FFMPEG_CI_ADMISSION });
		await extract({ archivePath, sourceRoot, admission: FRAMESCAPER_FFMPEG_CI_ADMISSION });
		const tree = collectTree(await canonicalDirectory(sourceRoot, 'FFmpeg source root'));
		if (tree.algorithm !== FRAMESCAPER_FFMPEG_CI_ADMISSION.extractedTree.algorithm
			|| tree.fileCount !== FRAMESCAPER_FFMPEG_CI_ADMISSION.extractedTree.fileCount
			|| tree.sha256 !== FRAMESCAPER_FFMPEG_CI_ADMISSION.extractedTree.sha256) {
			throw new Error('The extracted FFmpeg source tree drifted from its exact pin.');
		}
		await writeFile(join(sourceRoot, '.framescaper-source-identity.json'), `${JSON.stringify({
			schemaVersion: 1,
			component: 'ffmpeg',
			version: FRAMESCAPER_FFMPEG_CI_ADMISSION.version,
			archiveSha256: FRAMESCAPER_FFMPEG_CI_ADMISSION.archive.sha256,
			extractedTreeSha256: tree.sha256,
			root: sourceRoot,
		}, null, '\t')}\n`, { flag: 'wx', mode: 0o400 });
		await rm(archivePath, { force: true });
		await publishEnvironment(githubEnvironmentPath, sourceRoot);
		return Object.freeze({ workspace, sourceRoot, tree });
	} catch (error) {
		await rm(workspace, { recursive: true, force: true });
		throw error;
	}
}

export async function downloadPinnedFramescaperFfmpeg({
	destination, admission = FRAMESCAPER_FFMPEG_CI_ADMISSION, fetchImpl = globalThis.fetch,
}) {
	const path = absolutePath(destination, 'FFmpeg archive');
	if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
	const response = await fetchImpl(admission.url, {
		redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	});
	if (!response?.ok || response.status !== 200 || response.url !== admission.url
		|| response.body === null || response.body === undefined) {
		throw new Error('The FFmpeg download did not match its exact URL admission.');
	}
	let handle;
	let created = false;
	try {
		handle = await open(path, 'wx', 0o600);
		created = true;
		const hash = createHash('sha256');
		let byteLength = 0;
		for await (const value of response.body) {
			const bytes = Buffer.from(value);
			byteLength += bytes.byteLength;
			if (byteLength > admission.archive.byteLength) {
				throw new Error('The FFmpeg download exceeded its exact byte length.');
			}
			hash.update(bytes);
			await writeAll(handle, bytes);
		}
		await handle.sync();
		if (byteLength !== admission.archive.byteLength
			|| hash.digest('hex') !== admission.archive.sha256) {
			throw new Error('The FFmpeg download failed exact length and digest authentication.');
		}
	} catch (error) {
		await handle?.close().catch(() => {});
		handle = undefined;
		if (created) await rm(path, { force: true });
		throw error;
	} finally { await handle?.close(); }
	return Object.freeze({ path, ...admission.archive });
}

export async function extractPinnedFramescaperFfmpeg({ archivePath, sourceRoot, admission }) {
	const archive = await canonicalFile(archivePath, 'FFmpeg archive');
	if (archive.byteLength !== admission.archive.byteLength
		|| createHash('sha256').update(archive).digest('hex') !== admission.archive.sha256) {
		throw new Error('The FFmpeg archive changed before extraction.');
	}
	const destination = absolutePath(sourceRoot, 'FFmpeg source root');
	await mkdir(destination, { recursive: false, mode: 0o700 });
	const outcome = spawnSync('tar', [
		'-xJf', archivePath, '--strip-components=1', '-C', destination,
	], { encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_OUTPUT_BYTES });
	if (outcome.status !== 0 || outcome.error !== undefined || outcome.signal !== null) {
		throw new Error(`FFmpeg extraction failed: ${String(outcome.stderr ?? outcome.error?.message ?? '')}`);
	}
}

async function publishEnvironment(pathValue, sourceRoot) {
	if (sourceRoot.includes('\n') || sourceRoot.includes('\r')) {
		throw new Error('The FFmpeg source root is not environment-safe.');
	}
	const path = await canonicalFilePath(pathValue, 'GITHUB_ENV');
	const metadata = await lstat(path);
	const bytes = Buffer.from(`FRAMESCAPER_FFMPEG_901_SOURCE_ROOT=${sourceRoot}\n`);
	if (metadata.size + bytes.byteLength > MAXIMUM_ENVIRONMENT_BYTES) {
		throw new RangeError('GITHUB_ENV plus the FFmpeg handoff exceeds its byte limit.');
	}
	const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
	try { await writeAll(handle, bytes); await handle.sync(); }
	finally { await handle.close(); }
}

function assertAdmission(repositoryRoot) {
	const manifest = readFramescaperMediaHostSourceManifest(repositoryRoot);
	const expected = FRAMESCAPER_FFMPEG_CI_ADMISSION;
	if (manifest.ffmpeg.version !== expected.version || manifest.ffmpeg.url !== expected.url
		|| manifest.ffmpeg.byteLength !== expected.archive.byteLength
		|| manifest.ffmpeg.sha256 !== expected.archive.sha256
		|| JSON.stringify(manifest.ffmpeg.extractedTree) !== JSON.stringify(expected.extractedTree)) {
		throw new Error('Framescaper FFmpeg CI admission disagrees with the source manifest.');
	}
}

async function writeAll(handle, bytes) {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
		if (bytesWritten < 1) throw new Error('Bounded FFmpeg CI output made no progress.');
		offset += bytesWritten;
	}
}

async function canonicalDirectory(value, label) {
	const path = absolutePath(value, label);
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error(`The ${label} must be one canonical directory.`);
	}
	return path;
}

async function canonicalFile(value, label) {
	return readFile(await canonicalFilePath(value, label));
}

async function canonicalFilePath(value, label) {
	const path = absolutePath(value, label);
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error(`The ${label} must be one canonical regular file.`);
	}
	return path;
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} must be absolute and normalized.`);
	return value;
}

function assertContained(root, path, label) {
	const child = relative(root, path);
	if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new Error(`${label} must remain below RUNNER_TEMP.`);
	}
}
