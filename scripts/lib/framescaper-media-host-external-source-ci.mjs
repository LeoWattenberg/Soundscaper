/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact source-set provisioning for the native media host's linked libraries. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import {
	lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
	authenticateFramescaperMediaHostExternalSourceRoot,
	validateFramescaperMediaHostExternalSourceManifest,
} from '../../native/framescaper-media-host/build/external-source-authentication.mjs';

export const FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_MANIFEST =
	'native/framescaper-media-host/build/ffmpeg-9.0.1-external-sources.json';

const DOWNLOAD_TIMEOUT_MS = 300_000;
const MAXIMUM_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAXIMUM_ENVIRONMENT_BYTES = 1024 * 1024;
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;

export async function runFramescaperMediaHostExternalSourceCiProvisioning(
	options, dependencies = {},
) {
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	const runnerTemp = await canonicalDirectory(options?.runnerTemp, 'RUNNER_TEMP');
	const githubEnvironmentPath = await canonicalFilePath(options?.githubEnvironmentPath, 'GITHUB_ENV');
	assertContained(runnerTemp, githubEnvironmentPath, 'GITHUB_ENV');
	const manifest = sourceManifest(repositoryRoot);
	const workspace = await mkdtemp(join(runnerTemp, 'soundscaper-framescaper-media-sources-'));
	const sourceSetRoot = join(workspace, 'sources');
	await mkdir(sourceSetRoot, { mode: 0o700 });
	const download = dependencies.download ?? downloadPinnedFramescaperMediaHostSource;
	const extract = dependencies.extract ?? extractPinnedFramescaperMediaHostSource;
	const authenticate = dependencies.authenticate
		?? authenticateFramescaperMediaHostExternalSourceRoot;
	const identities = [];
	try {
		for (const source of manifest.libraries) {
			const archivePath = join(workspace, `${source.id}.archive`);
			const sourceRoot = join(sourceSetRoot, source.id);
			await download({ destination: archivePath, source });
			await extract({ archivePath, sourceRoot, source });
			const canonicalRoot = await canonicalDirectory(sourceRoot, `${source.id} source root`);
			const identity = authenticate(manifest, source.id, canonicalRoot);
			await writeFile(join(canonicalRoot, '.framescaper-source-identity.json'), `${JSON.stringify({
				schemaVersion: 1,
				component: source.id,
				version: source.version,
				revision: source.revision,
				archiveSha256: source.sha256,
				extractedTreeSha256: source.extractedTree.sha256,
				root: canonicalRoot,
			}, null, '\t')}\n`, { flag: 'wx', mode: 0o400 });
			await rm(archivePath, { force: true });
			identities.push(Object.freeze({ ...identity, root: canonicalRoot }));
		}
		await publishEnvironment(githubEnvironmentPath, sourceSetRoot);
		return deepFreeze({ workspace, sourceSetRoot, sources: identities });
	} catch (error) {
		await rm(workspace, { recursive: true, force: true });
		throw error;
	}
}

export async function downloadPinnedFramescaperMediaHostSource({
	destination, source, fetchImpl,
}) {
	const path = absolutePath(destination, 'external-source archive');
	const admission = sourceAdmission(source);
	if (fetchImpl !== undefined && typeof fetchImpl !== 'function') {
		throw new TypeError('The injected fetch implementation must be callable.');
	}
	const response = fetchImpl === undefined
		? curlResponse(admission)
		: await fetchResponse(fetchImpl, admission);
	const length = response?.headers?.get('content-length');
	if (!response?.ok || response.status !== 200 || response.body === null
		|| response.body === undefined || (length !== null && length !== String(admission.byteLength))) {
		throw new Error(`${admission.id} download failed its URL and length admission.`);
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
			if (byteLength > admission.byteLength) {
				throw new Error(`${admission.id} download exceeded its exact length.`);
			}
			hash.update(bytes);
			await writeAll(handle, bytes);
		}
		await handle.sync();
		if (byteLength !== admission.byteLength || hash.digest('hex') !== admission.sha256) {
			throw new Error(`${admission.id} download failed exact digest authentication.`);
		}
	} catch (error) {
		await handle?.close().catch(() => {});
		handle = undefined;
		if (created) await rm(path, { force: true });
		throw error;
	} finally { await handle?.close(); }
	return Object.freeze({ path, byteLength: admission.byteLength, sha256: admission.sha256 });
}

async function fetchResponse(fetchImpl, admission) {
	let response;
	let fetchError;
	for (let attempt = 0; attempt < 3 && response === undefined; attempt += 1) {
		try {
			response = await fetchImpl(admission.url, {
				redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
			});
		} catch (error) { fetchError = error; }
	}
	if (response === undefined) {
		throw new Error(`${admission.id} download could not reach its pinned URL.`, { cause: fetchError });
	}
	return response;
}

function curlResponse(admission) {
	const outcome = spawnSync('curl', [
		'--fail', '--location', '--silent', '--show-error', '--retry', '2',
		'--max-time', String(DOWNLOAD_TIMEOUT_MS / 1_000),
		'--max-filesize', String(admission.byteLength), '--proto', '=https', admission.url,
	], { shell: false, maxBuffer: admission.byteLength + MAXIMUM_OUTPUT_BYTES });
	if (outcome.status !== 0 || outcome.error !== undefined || outcome.signal !== null
		|| !Buffer.isBuffer(outcome.stdout)) {
		throw new Error(`${admission.id} download could not reach its pinned URL.`, {
			cause: outcome.error,
		});
	}
	return {
		ok: true, status: 200, body: [outcome.stdout],
		headers: { get: () => String(outcome.stdout.byteLength) },
	};
}

export async function extractPinnedFramescaperMediaHostSource({ archivePath, sourceRoot, source }) {
	const admission = sourceAdmission(source);
	const bytes = await canonicalFile(archivePath, `${admission.id} archive`);
	if (bytes.byteLength !== admission.byteLength || sha256(bytes) !== admission.sha256) {
		throw new Error(`${admission.id} archive changed before extraction.`);
	}
	const destination = absolutePath(sourceRoot, `${admission.id} source root`);
	await mkdir(destination, { recursive: false, mode: 0o700 });
	const outcome = spawnSync('tar', [
		'-xf', archivePath, '--strip-components=1', '-C', destination,
	], { encoding: 'utf8', shell: false, maxBuffer: MAXIMUM_OUTPUT_BYTES });
	if (outcome.status !== 0 || outcome.error !== undefined || outcome.signal !== null) {
		throw new Error(`${admission.id} extraction failed: ${String(outcome.stderr ?? outcome.error?.message ?? '')}`);
	}
}

function sourceManifest(repositoryRoot) {
	const bytes = JSON.parse(readFileSync(resolve(
		repositoryRoot, FRAMESCAPER_MEDIA_HOST_EXTERNAL_SOURCE_MANIFEST,
	), 'utf8'));
	return validateFramescaperMediaHostExternalSourceManifest(bytes);
}

function sourceAdmission(value) {
	if (!value || typeof value !== 'object' || typeof value.id !== 'string'
		|| typeof value.url !== 'string' || !value.url.startsWith('https://')
		|| !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
		|| value.byteLength > MAXIMUM_ARCHIVE_BYTES
		|| typeof value.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(value.sha256)) {
		throw new TypeError('A media-host external-source admission is invalid.');
	}
	return value;
}

async function publishEnvironment(pathValue, sourceSetRoot) {
	if (sourceSetRoot.includes('\n') || sourceSetRoot.includes('\r')) {
		throw new Error('The external-source root is not environment-safe.');
	}
	const path = await canonicalFilePath(pathValue, 'GITHUB_ENV');
	const before = await lstat(path);
	const bytes = Buffer.from(`FRAMESCAPER_MEDIA_EXTERNAL_SOURCE_ROOT=${sourceSetRoot}\n`);
	if (before.size + bytes.byteLength > MAXIMUM_ENVIRONMENT_BYTES) {
		throw new RangeError('GITHUB_ENV plus the media source-set handoff exceeds its limit.');
	}
	const handle = await open(path,
		constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
	try { await writeAll(handle, bytes); await handle.sync(); }
	finally { await handle.close(); }
}

async function writeAll(handle, bytes) {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null);
		if (bytesWritten < 1) throw new Error('Bounded source-set output made no progress.');
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

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function deepFreeze(value) {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}
