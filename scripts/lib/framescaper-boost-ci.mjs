/* SPDX-License-Identifier: AGPL-3.0-only */

/** Digest-authenticated Boost header provisioning for required Framescaper CI tests. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import {
	lstat, mkdtemp, mkdir, open, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
	readFramescaperMediaHostSourceManifest,
	verifyFramescaperMediaHostBoostClosure,
} from './framescaper-media-host-build.mjs';

export const FRAMESCAPER_BOOST_CI_ADMISSION = deepFreeze({
	version: '1.92.0',
	requestUrl: 'https://archives.boost.io/release/1.92.0/source/boost_1_92_0.tar.bz2',
	archive: {
		fileName: 'boost_1_92_0.tar.bz2',
		byteLength: 199_030_664,
		sha256: '5c1d40cb8e19adbf740a4ec2da35b3e58f3f5804b1dce44deb53df72193cbc6c',
	},
	archiveRoot: 'boost_1_92_0',
});

const DOWNLOAD_TIMEOUT_MS = 300_000;
const MAXIMUM_CLOSURE_FILES = 4_096;
const MAXIMUM_CLOSURE_FILE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_CLOSURE_BYTES = 128 * 1024 * 1024;
const MAXIMUM_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MAXIMUM_GITHUB_ENVIRONMENT_BYTES = 1024 * 1024;

/** Provision only the exact Boost header tree needed by the Framescaper native shard. */
export async function runFramescaperBoostCiProvisioning(options, dependencies = {}) {
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	const runnerTemp = await canonicalDirectory(options?.runnerTemp, 'RUNNER_TEMP');
	const githubEnvironmentPath = await canonicalFile(options?.githubEnvironmentPath, 'GITHUB_ENV');
	assertContained(runnerTemp, githubEnvironmentPath, 'GITHUB_ENV');
	assertAdmissionMatchesRepository(repositoryRoot);

	const workspace = await mkdtemp(join(runnerTemp, 'soundscaper-framescaper-boost-'));
	const plan = deepFreeze({
		repositoryRoot,
		runnerTemp,
		githubEnvironmentPath,
		workspace,
		archivePath: join(workspace, FRAMESCAPER_BOOST_CI_ADMISSION.archive.fileName),
		extractedSourceRoot: join(workspace, FRAMESCAPER_BOOST_CI_ADMISSION.archiveRoot),
		closureRoot: join(workspace, 'verified-header-closure'),
	});
	const download = dependencies.download ?? downloadPinnedFramescaperBoost;
	const extract = dependencies.extract ?? extractPinnedFramescaperBoost;
	const verify = dependencies.verify ?? verifyFramescaperMediaHostBoostClosure;
	const materialize = dependencies.materialize ?? materializeVerifiedFramescaperBoostClosure;

	await download({
		destination: plan.archivePath,
		admission: FRAMESCAPER_BOOST_CI_ADMISSION,
	});
	await extract({
		archivePath: plan.archivePath,
		sourceRoot: plan.extractedSourceRoot,
		admission: FRAMESCAPER_BOOST_CI_ADMISSION,
	});
	const extractedSourceRoot = await canonicalDirectory(
		plan.extractedSourceRoot, 'extracted Boost source root',
	);
	const closure = await verify({ repositoryRoot, boostSourceRoot: extractedSourceRoot });
	const materialized = await materialize({
		sourceRoot: extractedSourceRoot, closureRoot: plan.closureRoot, closure,
	});
	const sourceRoot = await canonicalDirectory(materialized, 'Boost closure root');
	await verify({ repositoryRoot, boostSourceRoot: sourceRoot });
	await Promise.all([
		rm(plan.archivePath, { force: true }),
		rm(extractedSourceRoot, { recursive: true, force: true }),
	]);
	await publishBoostEnvironment({ githubEnvironmentPath, sourceRoot });
	return deepFreeze({ workspace, sourceRoot });
}

/** Stream one pinned archive to an absent path and remove it on every admission failure. */
export async function downloadPinnedFramescaperBoost({
	destination, admission = FRAMESCAPER_BOOST_CI_ADMISSION, fetchImpl = globalThis.fetch,
}) {
	const path = absoluteNormalizedPath(destination, 'Boost archive');
	if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
	const expected = admission?.archive;
	if (typeof admission?.requestUrl !== 'string' || !expected
		|| !Number.isSafeInteger(expected.byteLength) || expected.byteLength < 1
		|| typeof expected.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(expected.sha256)) {
		throw new TypeError('Boost download admission is invalid.');
	}
	const response = await fetchImpl(admission.requestUrl, {
		redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	});
	if (!response?.ok || response.status !== 200 || response.url !== admission.requestUrl
		|| response.headers?.get('content-length') !== String(expected.byteLength)
		|| response.body === null || response.body === undefined) {
		throw new Error('Boost download did not match its exact URL and length admission.');
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
				throw new Error('Boost download exceeded its exact byte length.');
			}
			hash.update(bytes);
			await writeAll(handle, bytes);
		}
		await handle.sync();
		if (byteLength !== expected.byteLength || hash.digest('hex') !== expected.sha256) {
			throw new Error('Boost download failed its exact digest admission.');
		}
	} catch (error) {
		await handle?.close().catch(() => {});
		handle = undefined;
		await rm(path, { force: true });
		throw error;
	} finally {
		await handle?.close();
	}
	await canonicalFile(path, 'Boost archive');
	return deepFreeze({ path, byteLength: expected.byteLength, sha256: expected.sha256 });
}

/** Copy exactly the authenticated include closure into a clean compiler root. */
export async function materializeVerifiedFramescaperBoostClosure({
	sourceRoot: sourceValue, closureRoot: closureValue, closure,
}) {
	const sourceRoot = await canonicalDirectory(sourceValue, 'extracted Boost source root');
	const closureRoot = absoluteNormalizedPath(closureValue, 'Boost closure root');
	if (contained(sourceRoot, closureRoot) || contained(closureRoot, sourceRoot)) {
		throw new Error('The Boost closure root must be separate from its extracted source root.');
	}
	const files = normalizeClosureFiles(closure);
	await mkdir(closureRoot, { recursive: false, mode: 0o700 });
	try {
		for (const file of files) {
			const source = containedPath(sourceRoot, file.path, 'Boost closure source');
			const metadata = await lstat(source);
			if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(source) !== source) {
				throw new Error(`Boost closure header ${file.path} must be one canonical regular file.`);
			}
			const bytes = await readFile(source);
			if (bytes.byteLength !== file.byteLength
				|| createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
				throw new Error(`Boost closure header ${file.path} changed after verification.`);
			}
			const destination = containedPath(closureRoot, file.path, 'Boost closure destination');
			await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
			await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
		}
		return await canonicalDirectory(closureRoot, 'Boost closure root');
	} catch (error) {
		await rm(closureRoot, { recursive: true, force: true });
		throw error;
	}
}

async function extractPinnedFramescaperBoost({ archivePath, sourceRoot, admission }) {
	await canonicalFile(archivePath, 'Boost archive');
	await mkdir(sourceRoot, { recursive: false, mode: 0o700 });
	const outcome = spawnSync('tar', [
		'-xjf', archivePath,
		'--strip-components=1',
		'-C', sourceRoot,
		`${admission.archiveRoot}/boost`,
	], {
		encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_COMMAND_OUTPUT_BYTES,
	});
	assertSuccessful(outcome, 'Boost header extraction');
	const entries = await readdir(sourceRoot, { withFileTypes: true });
	if (entries.length !== 1 || entries[0].name !== 'boost'
		|| !entries[0].isDirectory() || entries[0].isSymbolicLink()) {
		throw new Error('Boost archive did not extract one exact header root.');
	}
}

function assertAdmissionMatchesRepository(repositoryRoot) {
	const host = readFramescaperMediaHostSourceManifest(repositoryRoot);
	const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, host.boost.sourceManifest), 'utf8'));
	const expected = FRAMESCAPER_BOOST_CI_ADMISSION;
	if (host.boost.version !== expected.version
		|| host.boost.archiveSha256 !== expected.archive.sha256
		|| manifest.source?.archiveUrl !== expected.requestUrl
		|| manifest.source.archiveFileName !== expected.archive.fileName
		|| manifest.source.archiveByteLength !== expected.archive.byteLength
		|| manifest.source.sha256 !== expected.archive.sha256) {
		throw new Error('Framescaper CI Boost admission disagrees with the maintained source manifests.');
	}
}

function normalizeClosureFiles(closure) {
	if (!closure || typeof closure !== 'object' || !Array.isArray(closure.files)
		|| !Number.isSafeInteger(closure.fileCount)
		|| closure.fileCount !== closure.files.length
		|| closure.files.length < 1 || closure.files.length > MAXIMUM_CLOSURE_FILES) {
		throw new TypeError('The verified Boost closure has an invalid file inventory.');
	}
	let previous = null;
	let totalBytes = 0;
	for (const file of closure.files) {
		if (!file || typeof file !== 'object' || typeof file.path !== 'string'
			|| !file.path.startsWith('boost/') || file.path.includes('\\') || file.path.includes('\0')
			|| file.path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
			throw new TypeError('The verified Boost closure contains a noncanonical header path.');
		}
		if (previous !== null && file.path <= previous) {
			throw new TypeError('The verified Boost closure file inventory must be uniquely sorted.');
		}
		if (!Number.isSafeInteger(file.byteLength) || file.byteLength < 1
			|| file.byteLength > MAXIMUM_CLOSURE_FILE_BYTES
			|| typeof file.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(file.sha256)) {
			throw new TypeError('The verified Boost closure contains an invalid header identity.');
		}
		totalBytes += file.byteLength;
		if (totalBytes > MAXIMUM_CLOSURE_BYTES) {
			throw new TypeError('The verified Boost closure exceeds its byte budget.');
		}
		previous = file.path;
	}
	return closure.files;
}

async function publishBoostEnvironment({ githubEnvironmentPath, sourceRoot }) {
	if (sourceRoot.includes('\n') || sourceRoot.includes('\r')) {
		throw new Error('Boost source root cannot be published to GITHUB_ENV.');
	}
	const path = await canonicalFile(githubEnvironmentPath, 'GITHUB_ENV');
	const before = await lstat(path);
	const bytes = Buffer.from(`FRAMESCAPER_BOOST_192_SOURCE_ROOT=${sourceRoot}\n`);
	if (!Number.isSafeInteger(before.size) || before.size < 0
		|| bytes.byteLength > MAXIMUM_GITHUB_ENVIRONMENT_BYTES - before.size) {
		throw new Error('GITHUB_ENV plus the Boost handoff exceeds its bounded size.');
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

function containedPath(root, repositoryPath, label) {
	const path = resolve(root, ...repositoryPath.split('/'));
	if (!contained(root, path)) throw new Error(`${label} escaped its root.`);
	return path;
}

function contained(root, path) {
	const child = relative(root, path);
	return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
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
