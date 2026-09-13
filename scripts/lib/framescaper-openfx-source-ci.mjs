/* SPDX-License-Identifier: AGPL-3.0-only */

/** Repository-owned provisioning for the exact OpenFX source consumed by target CI. */

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { collectExtractedSourceTree } from
	'../../native/framescaper-media-host/build/source-authentication.mjs';
import { materializeMilestone5SourceArchive } from
	'./milestone-5-source-archive-extraction.mjs';

const SOURCE_MANIFEST = 'native/framescaper-openfx-host/source-manifest.json';
const RECEIPT_NAME = '.framescaper-source-identity.json';
const MAXIMUM_ARCHIVE_BYTES = 32 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 300_000;

export async function provisionFramescaperOpenFxCiSource(options, dependencies = {}) {
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	const destinationRoot = await absentAbsolutePath(options?.destinationRoot, 'OpenFX source root');
	await canonicalDirectory(dirname(destinationRoot), 'OpenFX source parent');
	const manifest = await sourceManifest(repositoryRoot);
	const fetchImpl = dependencies.fetch ?? globalThis.fetch;
	if (typeof fetchImpl !== 'function') throw new TypeError('An OpenFX source fetch implementation is required.');
	const archiveBytes = await downloadPinnedArchive(manifest.openfx, fetchImpl);
	let materialized = false;
	try {
		await materializeMilestone5SourceArchive({
			destinationRoot,
			archiveBytes,
			archiveName: 'openfx-1.5.1-ab77951.tar.gz',
			expectedTree: manifest.openfx.extractedTree,
		});
		materialized = true;
		const receipt = {
			schemaVersion: 1,
			component: 'openfx',
			version: manifest.openfx.version,
			commitSha: manifest.openfx.commitSha,
			archiveSha256: manifest.openfx.sha256,
			extractedTreeSha256: manifest.openfx.extractedTree.sha256,
			root: destinationRoot,
		};
		await writeFile(resolve(destinationRoot, RECEIPT_NAME), canonicalJson(receipt), {
			flag: 'wx', mode: 0o400,
		});
		await verifyFramescaperOpenFxCiSource({ repositoryRoot, sourceRoot: destinationRoot });
		return Object.freeze({ sourceRoot: destinationRoot, receipt: Object.freeze(receipt) });
	} catch (error) {
		if (materialized) await rm(destinationRoot, { recursive: true, force: true });
		throw error;
	}
}

export async function verifyFramescaperOpenFxCiSource(options) {
	const repositoryRoot = await canonicalDirectory(options?.repositoryRoot, 'repository root');
	const sourceRoot = await canonicalDirectory(options?.sourceRoot, 'OpenFX source root');
	const manifest = await sourceManifest(repositoryRoot);
	const receipt = parseJson(await readCanonicalFile(
		resolve(sourceRoot, RECEIPT_NAME), 'OpenFX source receipt', 16 * 1024,
	), 'OpenFX source receipt');
	const expectedReceipt = {
		schemaVersion: 1,
		component: 'openfx',
		version: manifest.openfx.version,
		commitSha: manifest.openfx.commitSha,
		archiveSha256: manifest.openfx.sha256,
		extractedTreeSha256: manifest.openfx.extractedTree.sha256,
		root: sourceRoot,
	};
	if (JSON.stringify(receipt) !== JSON.stringify(expectedReceipt)) {
		throw new Error('The provisioned OpenFX source receipt drifted from its repository pin.');
	}
	const tree = collectExtractedSourceTree(sourceRoot);
	if (tree.algorithm !== manifest.openfx.extractedTree.algorithm
		|| tree.fileCount !== manifest.openfx.extractedTree.fileCount
		|| tree.sha256 !== manifest.openfx.extractedTree.sha256) {
		throw new Error('The provisioned OpenFX source tree drifted from its repository pin.');
	}
	return Object.freeze({ sourceRoot, receipt: Object.freeze(receipt) });
}

async function downloadPinnedArchive(pin, fetchImpl) {
	if (!Number.isSafeInteger(pin.byteLength) || pin.byteLength < 1
		|| pin.byteLength > MAXIMUM_ARCHIVE_BYTES || !/^[a-f\d]{64}$/u.test(pin.sha256)) {
		throw new TypeError('The repository OpenFX archive pin is invalid.');
	}
	const response = await fetchImpl(pin.url, {
		redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
	});
	if (!response?.ok || response.body === null || response.body === undefined) {
		throw new Error(`The pinned OpenFX source request failed with HTTP ${String(response?.status)}.`);
	}
	const declaredLength = response.headers?.get?.('content-length');
	if (declaredLength !== null && declaredLength !== undefined
		&& declaredLength !== String(pin.byteLength)) {
		throw new Error('The pinned OpenFX source response has the wrong declared byte length.');
	}
	const chunks = [];
	const hash = createHash('sha256');
	let byteLength = 0;
	for await (const value of response.body) {
		const bytes = Buffer.from(value);
		byteLength += bytes.byteLength;
		if (byteLength > pin.byteLength) throw new Error('The OpenFX source response exceeded its pin.');
		hash.update(bytes);
		chunks.push(bytes);
	}
	if (byteLength !== pin.byteLength || hash.digest('hex') !== pin.sha256) {
		throw new Error('The downloaded OpenFX source bytes drifted from their repository pin.');
	}
	return Buffer.concat(chunks, byteLength);
}

async function sourceManifest(repositoryRoot) {
	const bytes = await readCanonicalFile(resolve(repositoryRoot, SOURCE_MANIFEST),
		'OpenFX source manifest', 2 * 1024 * 1024);
	const manifest = parseJson(bytes, 'OpenFX source manifest');
	if (manifest.schemaVersion !== 1 || manifest.openfx?.version !== '1.5.1'
		|| manifest.openfx?.commitSha !== 'ab779510b2655b4d11a7e01e5c521f9aa8c88976') {
		throw new TypeError('The repository OpenFX source identity is unsupported.');
	}
	return manifest;
}

async function readCanonicalFile(path, label, maximumBytes) {
	const before = await lstat(path);
	if (!before.isFile() || before.isSymbolicLink() || await realpath(path) !== path
		|| before.size < 1 || before.size > maximumBytes) {
		throw new Error(`The ${label} is not one bounded canonical file.`);
	}
	const bytes = await readFile(path);
	const after = await lstat(path);
	if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
		|| before.mtimeMs !== after.mtimeMs || bytes.byteLength !== before.size) {
		throw new Error(`The ${label} changed while reading.`);
	}
	return bytes;
}

async function canonicalDirectory(value, label) {
	const path = absolutePath(value, label);
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error(`The ${label} is not one canonical directory.`);
	}
	return path;
}

function absentAbsolutePath(value, label) {
	const path = absolutePath(value, label);
	return lstat(path).then(() => { throw new Error(`The ${label} already exists.`); }, (error) => {
		if (error?.code !== 'ENOENT') throw error;
		return path;
	});
}

function absolutePath(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value
		|| value.includes('\0')) throw new TypeError(`The ${label} must be absolute and normalized.`);
	return value;
}

function parseJson(bytes, label) {
	try { return JSON.parse(String(bytes)); }
	catch (error) { throw new Error(`The ${label} is invalid JSON.`, { cause: error }); }
}

function canonicalJson(value) {
	return Buffer.from(`${JSON.stringify(value, null, '\t')}\n`);
}
