/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import {
	closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync,
	readSync, realpathSync, statSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const EXTRACTED_SOURCE_TREE_ALGORITHM =
	'framescaper-portable-source-tree-sha256-v1';
export const BOOST_HEADER_CLOSURE_ALGORITHM = 'boost-include-closure-sha256-v1';

const SOURCE_RECEIPT = '.framescaper-source-identity.json';
const BOOST_INCLUDE = /^\s*#\s*include\s*[<"](boost\/[^>"]+)[>"]/gmu;
const DIGEST = /^[a-f0-9]{64}$/u;
const MAXIMUM_SOURCE_FILES = 100_000;
const MAXIMUM_SOURCE_FILE_BYTES = 512 * 1024 * 1024;
const MAXIMUM_SOURCE_TREE_BYTES = 4 * 1024 * 1024 * 1024;
const MAXIMUM_SOURCE_FILE_BYTES_BIGINT = BigInt(MAXIMUM_SOURCE_FILE_BYTES);

export function collectExtractedSourceTree(sourceRoot) {
	const root = canonicalDirectory(sourceRoot, 'extracted source root');
	const files = [];
	collectFiles(root, '', files, { totalBytes: 0, inodes: new Set() });
	files.sort(comparePath);
	const portablePaths = new Set();
	for (const file of files) {
		const folded = file.path.toLowerCase();
		if (portablePaths.has(folded)) {
			throw new Error(`Extracted source path ${file.path} is not portable across target filesystems.`);
		}
		portablePaths.add(folded);
	}
	const hash = createHash('sha256');
	hash.update(`${EXTRACTED_SOURCE_TREE_ALGORITHM}\0`, 'utf8');
	for (const file of files) {
		hash.update(`${file.path}\0${file.type}\0${file.byteLength}\0${file.sha256}\n`, 'utf8');
	}
	return Object.freeze({
		algorithm: EXTRACTED_SOURCE_TREE_ALGORITHM,
		fileCount: files.length,
		sha256: hash.digest('hex'),
		files: Object.freeze(files),
	});
}

export function collectBoostHeaderClosure(sourceRoot, rootsValue) {
	const root = canonicalDirectory(sourceRoot, 'Boost source root');
	const roots = normalizeBoostRoots(rootsValue);
	const pending = [...roots];
	const bodies = new Map();
	while (pending.length > 0) {
		const path = pending.pop();
		if (bodies.has(path)) continue;
		const bytes = readCanonicalFile(root, path, 'Boost header');
		bodies.set(path, bytes);
		for (const match of bytes.toString('utf8').matchAll(BOOST_INCLUDE)) {
			const included = normalizeBoostPath(match[1]);
			if (!bodies.has(included)) pending.push(included);
		}
	}
	const files = [...bodies].sort(([left], [right]) => compareStrings(left, right))
		.map(([path, bytes]) => Object.freeze({
			path, byteLength: bytes.byteLength, sha256: digest(bytes),
		}));
	const hash = createHash('sha256');
	hash.update(`${BOOST_HEADER_CLOSURE_ALGORITHM}\0`, 'utf8');
	for (const file of files) {
		hash.update(`${file.path}\0${file.byteLength}\0${file.sha256}\n`, 'utf8');
	}
	return Object.freeze({
		algorithm: BOOST_HEADER_CLOSURE_ALGORITHM,
		roots: Object.freeze(roots), fileCount: files.length,
		sha256: hash.digest('hex'), files: Object.freeze(files),
	});
}

export function addSourceTreeWitness(root, expectedValue, witnesses, label) {
	const expected = exactIdentity(expectedValue, EXTRACTED_SOURCE_TREE_ALGORITHM, label);
	const actual = collectExtractedSourceTree(root);
	assertIdentity(actual, expected, label);
	witnesses.push(Object.freeze({ kind: 'source-tree', root, expected, label }));
}

export function addBoostClosureWitness(root, expectedValue, witnesses, label) {
	const expected = exactBoostIdentity(expectedValue, label);
	const actual = collectBoostHeaderClosure(root, expected.roots);
	assertIdentity(actual, expected, label, true);
	witnesses.push(Object.freeze({ kind: 'boost-closure', root, expected, label }));
}

export function verifySourceAuthenticationWitness(witness) {
	if (witness.kind === 'source-tree') {
		assertIdentity(collectExtractedSourceTree(witness.root), witness.expected, witness.label);
		return true;
	}
	if (witness.kind === 'boost-closure') {
		assertIdentity(
			collectBoostHeaderClosure(witness.root, witness.expected.roots),
			witness.expected, witness.label, true,
		);
		return true;
	}
	return false;
}

function collectFiles(root, prefix, files, budget) {
	for (const name of readdirSync(join(root, prefix)).sort(compareStrings)) {
		if (prefix === '' && name === SOURCE_RECEIPT) continue;
		assertPortableSourceSegment(name);
		const path = prefix === '' ? name : `${prefix}/${name}`;
		const absolute = join(root, ...path.split('/'));
		const info = lstatSync(absolute, { bigint: true });
		if (info.isDirectory()) {
			if (info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
				throw new Error(`Extracted source directory ${path} is not canonical.`);
			}
			collectFiles(root, path, files, budget);
			continue;
		}
		if (!info.isFile() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
			throw new Error(`Extracted source entry ${path} is not one canonical regular file.`);
		}
		if (info.size > MAXIMUM_SOURCE_FILE_BYTES_BIGINT) {
			throw new Error(`Extracted source entry ${path} exceeds its file limit.`);
		}
		const inode = info.ino === 0n ? null : `${String(info.dev)}:${String(info.ino)}`;
		if (inode !== null && budget.inodes.has(inode)) {
			throw new Error(`Extracted source entry ${path} is a hard-linked duplicate.`);
		}
		if (inode !== null) budget.inodes.add(inode);
		const descriptor = describeCanonicalFile(absolute, path, info);
		budget.totalBytes += descriptor.byteLength;
		if (files.length >= MAXIMUM_SOURCE_FILES || budget.totalBytes > MAXIMUM_SOURCE_TREE_BYTES) {
			throw new Error('Extracted source tree exceeds its admission budget.');
		}
		files.push(Object.freeze(descriptor));
	}
}

function describeCanonicalFile(absolute, path, before) {
	const handle = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = fstatSync(handle, { bigint: true });
		if (!opened.isFile() || opened.size !== before.size
			|| (before.ino !== 0n && opened.ino !== 0n
				&& (before.dev !== opened.dev || before.ino !== opened.ino))) {
			throw new Error(`Extracted source entry ${path} changed while opening.`);
		}
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(1024 * 1024);
		let byteLength = 0;
		for (;;) {
			const bytesRead = readSync(handle, buffer, 0, buffer.byteLength, null);
			if (bytesRead === 0) break;
			byteLength += bytesRead;
			if (byteLength > MAXIMUM_SOURCE_FILE_BYTES) {
				throw new Error(`Extracted source entry ${path} exceeds its file limit.`);
			}
			hash.update(buffer.subarray(0, bytesRead));
		}
		const after = fstatSync(handle, { bigint: true });
		if (BigInt(byteLength) !== opened.size || after.size !== opened.size
			|| after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
			throw new Error(`Extracted source entry ${path} changed while hashing.`);
		}
		return { path, type: 'file', byteLength, sha256: hash.digest('hex') };
	} finally {
		closeSync(handle);
	}
}

/**
 * Admit NFC Unicode archive names shared by POSIX, APFS, and Windows. Upstream
 * SDKs legitimately use spaces, `@`, parentheses, and registered-mark glyphs;
 * the Windows forbidden/reserved sets remain excluded so one tree identity is
 * extractable on every qualified target.
 */
function assertPortableSourceSegment(name) {
	const windowsBase = name.split('.')[0].toUpperCase();
	if (name.length < 1 || name === '.' || name === '..'
		|| name.normalize('NFC') !== name
		|| hasControlCharacter(name)
		|| /[<>:"/\\|?*]/u.test(name)
		|| /[ .]$/u.test(name)
		|| Buffer.byteLength(name, 'utf8') > 255
		|| /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(windowsBase)) {
		throw new Error(`Extracted source path ${name} is not one portable canonical path segment.`);
	}
}

function hasControlCharacter(value) {
	return [...value].some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint <= 0x1f || codePoint === 0x7f;
	});
}

function exactIdentity(value, algorithm, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join(',') !== 'algorithm,fileCount,sha256'
		|| value.algorithm !== algorithm || !Number.isSafeInteger(value.fileCount)
		|| value.fileCount < 1 || !DIGEST.test(String(value.sha256))) {
		throw new TypeError(`${label} must have one exact pinned tree identity.`);
	}
	return Object.freeze({
		algorithm: value.algorithm, fileCount: value.fileCount, sha256: value.sha256,
	});
}

function exactBoostIdentity(value, label) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.keys(value).sort().join(',') !== 'algorithm,fileCount,roots,sha256') {
		throw new TypeError(`${label} must have one exact pinned Boost closure identity.`);
	}
	const base = exactIdentity({
		algorithm: value.algorithm, fileCount: value.fileCount, sha256: value.sha256,
	}, BOOST_HEADER_CLOSURE_ALGORITHM, label);
	return Object.freeze({ ...base, roots: Object.freeze(normalizeBoostRoots(value.roots)) });
}

function assertIdentity(actual, expected, label, includeRoots = false) {
	if (actual.algorithm !== expected.algorithm || actual.fileCount !== expected.fileCount
		|| actual.sha256 !== expected.sha256
		|| (includeRoots && actual.roots.join('\0') !== expected.roots.join('\0'))) {
		throw new Error(`${label} drifted from its pinned content closure.`);
	}
}

function normalizeBoostRoots(value) {
	if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
		throw new TypeError('Boost closure roots must be one bounded array.');
	}
	const roots = value.map(normalizeBoostPath);
	if (new Set(roots).size !== roots.length) throw new TypeError('Boost closure roots must be unique.');
	return roots;
}

function normalizeBoostPath(value) {
	if (typeof value !== 'string' || !value.startsWith('boost/') || value.includes('\\')
		|| value.includes('\0') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
		throw new TypeError('Boost closure contains a noncanonical header path.');
	}
	return value;
}

function readCanonicalFile(root, path, label) {
	const absolute = resolve(root, ...path.split('/'));
	const fromRoot = relative(root, absolute);
	if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
		throw new Error(`${label} escaped its source root.`);
	}
	const info = lstatSync(absolute);
	if (!info.isFile() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
		throw new Error(`${label} ${path} is not one canonical regular file.`);
	}
	return readFileSync(absolute);
}

function canonicalDirectory(value, label) {
	if (typeof value !== 'string' || !isAbsolute(value)) throw new TypeError(`${label} must be absolute.`);
	const root = resolve(value);
	const info = lstatSync(root);
	if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(root) !== root
		|| !statSync(root).isDirectory()) throw new Error(`${label} must be one canonical directory.`);
	return root;
}

function comparePath(left, right) { return compareStrings(left.path, right.path); }
function compareStrings(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
