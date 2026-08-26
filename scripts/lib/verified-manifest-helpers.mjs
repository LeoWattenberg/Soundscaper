/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { basename, posix, resolve } from 'node:path';

import { renameIntoPlaceExclusively } from './exclusive-rename.mjs';

export function assert(condition, message) {
	if (!condition) throw new Error(message);
}

export function assertCleanHttpsUrl(value, label) {
	let url;
	try { url = new URL(value); } catch { throw new Error(`${label} is invalid`); }
	assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
		`${label} must be a clean HTTPS URL`);
}

export function assertExactKeys(value, keys, label) {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	assert(canonicalJson(actual) === canonicalJson(expected),
		`${label} keys must be exactly ${expected.join(', ')}; received ${actual.join(', ') || '<none>'}`);
}

export function assertPlainObject(value, label) {
	assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}

// Manifest-relative paths are POSIX by construction: the checks below reject a
// leading separator, backslashes, and traversal components. They must therefore
// normalize with POSIX semantics on every host. Resolving them against the
// platform flavour attaches the current drive on Windows ("D:\\config\\..."),
// so the leading-separator check rejected every valid path there.
export function assertSafeRelativePath(value, label) {
	assert(typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\'), `${label} is invalid`);
	assert(value.split('/').every((part) => part && part !== '.' && part !== '..'), `${label} is invalid`);
	const normalized = posix.resolve(posix.sep, value);
	assert(normalized.startsWith(posix.sep) && normalized !== posix.sep, `${label} is invalid`);
}

export function assertSortedUnique(values, label) {
	assert(values.every((value) => typeof value === 'string' && value), `${label} must contain non-empty strings`);
	const normalized = [...new Set(values)].sort();
	assert(canonicalJson(values) === canonicalJson(normalized), `${label} must be sorted and unique`);
}

export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

export function deepFreeze(value) {
	if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}

export function parseJson(bytes, label) {
	try { return JSON.parse(String(bytes)); } catch (error) {
		throw new Error(`${label} is invalid JSON: ${error.message}`, { cause: error });
	}
}

export async function readRegularFile(root, relativePath, label) {
	assertSafeRelativePath(relativePath, `${label} path`);
	let current = root;
	for (const component of relativePath.split('/')) {
		current = resolve(current, component);
		const metadata = await lstat(current);
		assert(!metadata.isSymbolicLink(), `${label} contains a symbolic link: ${relativePath}`);
	}
	const metadata = await lstat(current);
	assert(metadata.isFile(), `${label} is not a regular file: ${relativePath}`);
	assert(metadata.size <= 64 * 1024 * 1024, `${label} is too large: ${relativePath}`);
	return readFile(current);
}

export async function readStagedRegularFile(path, label) {
	const metadata = await lstat(path);
	assert(metadata.isFile() && !metadata.isSymbolicLink(), `${label} is not a regular file: ${path}`);
	return readFile(path);
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

export function verifyDescriptorBytes(bytes, descriptor, label) {
	assert(bytes.byteLength === descriptor.byteLength,
		`${label} byte length mismatch: expected ${descriptor.byteLength}, received ${bytes.byteLength}`);
	assert(sha256(bytes) === descriptor.sha256, `${label} digest mismatch`);
}

export async function writeVerifiedFileExclusive(outputPath, bytes, label) {
	const destination = resolve(outputPath);
	await renameIntoPlaceExclusively(destination, label, async (temporary) => {
		const staged = resolve(temporary, basename(destination));
		await writeFile(staged, bytes, { flag: 'wx' });
		return staged;
	});
}
