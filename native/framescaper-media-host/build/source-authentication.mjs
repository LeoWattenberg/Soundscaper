/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const EXTRACTED_SOURCE_TREE_ALGORITHM =
	'framescaper-portable-source-tree-sha256-v1';
export const BOOST_HEADER_CLOSURE_ALGORITHM = 'boost-include-closure-sha256-v1';

const SOURCE_RECEIPT = '.framescaper-source-identity.json';
const BOOST_INCLUDE = /^\s*#\s*include\s*[<"](boost\/[^>"]+)[>"]/gmu;
const DIGEST = /^[a-f0-9]{64}$/u;

export function collectExtractedSourceTree(sourceRoot) {
	const root = canonicalDirectory(sourceRoot, 'extracted source root');
	const files = [];
	collectFiles(root, '', files);
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

function collectFiles(root, prefix, files) {
	for (const name of readdirSync(join(root, prefix)).sort(compareStrings)) {
		if (prefix === '' && name === SOURCE_RECEIPT) continue;
		if (!/^[a-zA-Z0-9._-]+$/u.test(name) || name === '.' || name === '..') {
			throw new Error(`Extracted source path ${name} is not one normalized POSIX path segment.`);
		}
		const path = prefix === '' ? name : `${prefix}/${name}`;
		const absolute = join(root, ...path.split('/'));
		const info = lstatSync(absolute);
		if (info.isDirectory()) {
			collectFiles(root, path, files);
			continue;
		}
		if (!info.isFile() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) {
			throw new Error(`Extracted source entry ${path} is not one canonical regular file.`);
		}
		const bytes = readFileSync(absolute);
		files.push(Object.freeze({
			path, type: 'file', byteLength: bytes.byteLength, sha256: digest(bytes),
		}));
	}
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
