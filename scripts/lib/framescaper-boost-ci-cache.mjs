/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAXIMUM_FILES = 4_096;
const MAXIMUM_FILE_BYTES = 16 * 1024 * 1024;
const MAXIMUM_BYTES = 128 * 1024 * 1024;

export function boostClosureCacheIdentity(admissions) {
	return hash(JSON.stringify({ schemaVersion: 1, ...admissions }));
}

/** Cached bytes are admitted again against the maintained closure before any compiler sees them. */
export async function readVerifiedBoostClosureCache({ cacheRoot, identity, verify, versionHeader }) {
	if (cacheRoot === undefined) return null;
	const root = await cacheDirectory(cacheRoot);
	const directory = cacheEntry(root, identity);
	const sourceRoot = join(directory, 'headers');
	try {
		const inventory = await regularFileInventory(sourceRoot);
		const closure = await verify(sourceRoot);
		const files = admittedFiles(closure, versionHeader);
		if (JSON.stringify(inventory) !== JSON.stringify(files.map(file => file.path))) {
			throw new Error('The cached Boost header inventory changed.');
		}
		for (const file of files) await admittedBytes(sourceRoot, file);
		return { sourceRoot, closure };
	} catch {
		await rm(directory, { recursive: true, force: true });
		return null;
	}
}

/** Persist header bytes only; workspace paths and exported identities are recreated on every run. */
export async function saveVerifiedBoostClosureCache({ cacheRoot, identity, sourceRoot, closure, versionHeader }) {
	if (cacheRoot === undefined) return;
	const root = await cacheDirectory(cacheRoot);
	const directory = cacheEntry(root, identity);
	const staging = await mkdtemp(join(root, '.staging-'));
	try {
		for (const file of admittedFiles(closure, versionHeader)) {
			const bytes = await admittedBytes(sourceRoot, file);
			const destination = join(staging, 'headers', ...file.path.split('/'));
			await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
			await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
		}
		await rm(directory, { recursive: true, force: true });
		await rename(staging, directory);
	} finally { await rm(staging, { recursive: true, force: true }); }
}

async function cacheDirectory(value) {
	const root = resolve(value);
	await mkdir(root, { recursive: true, mode: 0o700 });
	const metadata = await lstat(root);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(root) !== root) {
		throw new Error('The Boost cache must use a canonical non-symbolic directory.');
	}
	return root;
}

function cacheEntry(root, identity) {
	if (typeof identity !== 'string' || !/^[a-f\d]{64}$/u.test(identity)) {
		throw new Error('The Boost cache identity is invalid.');
	}
	return join(root, identity);
}

function admittedFiles(closure, versionHeader) {
	if (!Array.isArray(closure?.files) || closure.files.length > MAXIMUM_FILES) {
		throw new Error('The cached Boost closure has no bounded file inventory.');
	}
	const files = new Map();
	for (const file of [...closure.files, versionHeader]) {
		if (typeof file?.path !== 'string' || !file.path.startsWith('boost/')
			|| file.path.includes('\\') || file.path.includes('\0')
			|| file.path.split('/').some(part => !part || part === '.' || part === '..')
			|| !Number.isSafeInteger(file.byteLength) || file.byteLength < 1 || file.byteLength > MAXIMUM_FILE_BYTES
			|| typeof file.sha256 !== 'string' || !/^[a-f\d]{64}$/u.test(file.sha256)) {
			throw new Error('A cached Boost header has an invalid admission.');
		}
		const previous = files.get(file.path);
		if (previous && (previous.byteLength !== file.byteLength || previous.sha256 !== file.sha256)) {
			throw new Error('The Boost version header conflicts with its include-closure admission.');
		}
		files.set(file.path, file);
	}
	return [...files.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

async function admittedBytes(root, file) {
	const path = join(root, ...file.path.split('/'));
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(path) !== path) {
		throw new Error('A cached Boost header must be one canonical regular file.');
	}
	const bytes = await readFile(path);
	if (bytes.length !== file.byteLength || hash(bytes) !== file.sha256) {
		throw new Error('A cached Boost header failed its maintained digest admission.');
	}
	return bytes;
}

async function regularFileInventory(root) {
	const files = [];
	let byteLength = 0;
	async function visit(directory, prefix) {
		const metadata = await lstat(directory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory) {
			throw new Error('The cached Boost include tree contains a symbolic directory.');
		}
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			const relative = `${prefix}${entry.name}`;
			if (entry.isDirectory()) await visit(path, `${relative}/`);
			else {
				const file = await lstat(path);
				if (!file.isFile() || file.isSymbolicLink() || file.size > MAXIMUM_FILE_BYTES) {
					throw new Error('The cached Boost include tree contains a non-regular or oversized file.');
				}
				byteLength += file.size;
				files.push(relative);
				if (files.length > MAXIMUM_FILES || byteLength > MAXIMUM_BYTES) {
					throw new Error('The cached Boost include tree exceeds its bounds.');
				}
			}
		}
	}
	await visit(root, '');
	return files.sort();
}
