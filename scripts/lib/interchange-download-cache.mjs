/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const MAXIMUM_METADATA_BYTES = 16 * 1024 * 1024;
const MAXIMUM_WHEEL_BYTES = 128 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Installed readers stay disposable; only version-specific download inputs are reused. */
export function interchangeCacheIdentity(config, abi, supportedTags) {
	return hash(JSON.stringify({ schemaVersion: 1, config, abi, tags: [...supportedTags].sort() }));
}

export async function cachedInterchangeWheel(entry, {
	cacheRoot, cacheIdentity, release, download, selectPlatformWheel,
}) {
	if (!/^[a-f\d]{64}$/u.test(cacheIdentity)
		|| !/^[\w.-]+$/u.test(entry.name) || !/^[\w.+-]+$/u.test(entry.version)) {
		throw new TypeError('The interchange download cache identity is invalid.');
	}
	const directory = join(resolve(cacheRoot), cacheIdentity);
	await canonicalCacheDirectory(resolve(cacheRoot));
	await canonicalCacheDirectory(directory);
	const metadataPath = join(directory, `${entry.name}-${entry.version}.json`);
	let metadata = await readMetadata(metadataPath, entry);
	if (metadata === null) {
		metadata = validateRelease(await release(entry.name, entry.version), entry);
		const body = JSON.stringify(metadata);
		await replaceFile(metadataPath, JSON.stringify({
			schemaVersion: 1, byteLength: Buffer.byteLength(body), sha256: hash(body), body,
		}));
	}
	const file = entry.wheel === 'platform'
		? selectPlatformWheel(metadata.urls) : metadata.urls.find(candidate => candidate.filename === entry.wheel);
	if (!file) throw new Error(`No ${entry.name} ${entry.version} wheel matches this interpreter or pinned filename.`);
	const expected = entry.sha256 ?? file.digests?.sha256;
	if (typeof expected !== 'string' || !/^[a-f\d]{64}$/u.test(expected)) {
		throw new Error(`${file.filename} has no exact digest admission.`);
	}
	const wheelPath = join(directory, `${expected}.whl`);
	let bytes = await readWheel(wheelPath, expected);
	if (bytes === null) {
		bytes = Buffer.from(await download(file.url));
		if (bytes.byteLength > MAXIMUM_WHEEL_BYTES || hash(bytes) !== expected) {
			throw new Error(`${file.filename} failed its integrity check.\n  expected ${expected}\n  received ${hash(bytes)}`);
		}
		await replaceFile(wheelPath, bytes);
	}
	return { file, bytes };
}

async function readMetadata(path, entry) {
	try {
		const receipt = JSON.parse(await regularBytes(path, MAXIMUM_METADATA_BYTES));
		if (receipt.schemaVersion !== 1 || typeof receipt.body !== 'string'
			|| Buffer.byteLength(receipt.body) !== receipt.byteLength || hash(receipt.body) !== receipt.sha256) {
			throw new Error('The cached PyPI metadata receipt changed.');
		}
		return validateRelease(JSON.parse(receipt.body), entry);
	} catch {
		await rm(path, { recursive: true, force: true });
		return null;
	}
}

async function readWheel(path, expected) {
	try {
		const bytes = await regularBytes(path, MAXIMUM_WHEEL_BYTES);
		if (hash(bytes) !== expected) throw new Error('The cached wheel changed.');
		return bytes;
	} catch {
		await rm(path, { recursive: true, force: true });
		return null;
	}
}

function validateRelease(value, entry) {
	const normalizeName = name => name.toLowerCase().replaceAll(/[-_.]+/gu, '-');
	if (typeof value?.info?.name !== 'string' || normalizeName(value.info.name) !== normalizeName(entry.name)
		|| value.info.version !== entry.version || !Array.isArray(value.urls) || value.urls.length === 0) {
		throw new Error('The PyPI release metadata names a different package or version.');
	}
	for (const file of value.urls) {
		const url = new URL(file.url);
		if (typeof file.filename !== 'string' || url.protocol !== 'https:'
			|| url.hostname !== 'files.pythonhosted.org' || url.username || url.password || url.hash) {
			throw new Error('The PyPI release metadata has an invalid download identity.');
		}
	}
	return value;
}

async function canonicalCacheDirectory(path) {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const metadata = await lstat(path);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error('The interchange cache must use canonical non-symbolic directories.');
	}
}

async function regularBytes(path, maximum) {
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maximum
		|| await realpath(path) !== path) throw new Error('A cached download must be one bounded regular file.');
	return readFile(path);
}

async function replaceFile(path, bytes) {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
		await rename(temporary, path);
	} finally { await rm(temporary, { force: true }); }
}
