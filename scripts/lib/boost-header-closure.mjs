/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BOOST_HEADER_CLOSURE_ALGORITHM = 'boost-include-closure-sha256-v1';

const BOOST_INCLUDE = /^\s*#\s*include\s*[<"](boost\/[^>"]+)[>"]/gmu;

/**
 * Resolve a conservative Boost header closure. Every syntactic Boost include
 * is followed even when it sits behind a target-specific preprocessor branch,
 * so one manifest is sufficient for all five build targets.
 */
export async function collectBoostHeaderClosure(sourceRoot, roots) {
	const absoluteRoot = resolveSourceRoot(sourceRoot);
	const pending = [...normalizeRoots(roots)];
	const discovered = new Set();
	const bodies = new Map();
	while (pending.length > 0) {
		const path = pending.pop();
		if (discovered.has(path)) continue;
		const absolute = resolveInside(absoluteRoot, path);
		const info = await stat(absolute);
		if (!info.isFile()) throw new TypeError(`Boost header ${path} is not a regular file.`);
		const bytes = await readFile(absolute);
		discovered.add(path);
		bodies.set(path, bytes);
		const source = bytes.toString('utf8');
		for (const match of source.matchAll(BOOST_INCLUDE)) {
			const included = normalizeHeaderPath(match[1]);
			if (!discovered.has(included)) pending.push(included);
		}
	}
	const files = [...discovered].sort().map((path) => {
		const bytes = bodies.get(path);
		return Object.freeze({
			path,
			byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
		});
	});
	const digest = createHash('sha256');
	digest.update(`${BOOST_HEADER_CLOSURE_ALGORITHM}\0`, 'utf8');
	for (const file of files) {
		digest.update(`${file.path}\0${String(file.byteLength)}\0${file.sha256}\n`, 'utf8');
	}
	return Object.freeze({
		algorithm: BOOST_HEADER_CLOSURE_ALGORITHM,
		roots: Object.freeze([...normalizeRoots(roots)]),
		fileCount: files.length,
		sha256: digest.digest('hex'),
		files: Object.freeze(files),
	});
}

/** Assert that a collected closure is exactly the pinned manifest identity. */
export function verifyBoostHeaderClosureManifest(manifestValue, closureValue) {
	const manifest = closedRecord(manifestValue, ['algorithm', 'roots', 'fileCount', 'sha256'], 'Boost closure manifest');
	const closure = closedRecord(
		closureValue,
		['algorithm', 'roots', 'fileCount', 'sha256', 'files'],
		'collected Boost closure',
	);
	if (manifest.algorithm !== BOOST_HEADER_CLOSURE_ALGORITHM
		|| closure.algorithm !== BOOST_HEADER_CLOSURE_ALGORITHM) {
		throw new RangeError('Boost header closure algorithm is unsupported.');
	}
	const manifestRoots = normalizeRoots(manifest.roots);
	const closureRoots = normalizeRoots(closure.roots);
	if (manifestRoots.length !== closureRoots.length
		|| manifestRoots.some((root, index) => root !== closureRoots[index])) {
		throw new RangeError('Boost header closure roots disagree with the manifest.');
	}
	if (!Number.isSafeInteger(manifest.fileCount) || manifest.fileCount < 1
		|| manifest.fileCount !== closure.fileCount) {
		throw new RangeError('Boost header closure file count disagrees with the manifest.');
	}
	if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(manifest.sha256)
		|| manifest.sha256 !== closure.sha256) {
		throw new RangeError('Boost header closure digest disagrees with the manifest.');
	}
}

function resolveSourceRoot(value) {
	if (typeof value !== 'string' || !isAbsolute(value)) {
		throw new TypeError('Boost extracted source root must be an absolute path.');
	}
	return resolve(value);
}

function resolveInside(root, path) {
	const absolute = resolve(root, ...path.split('/'));
	const pathFromRoot = relative(root, absolute);
	if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..' || isAbsolute(pathFromRoot)) {
		throw new RangeError('A Boost header path escaped the extracted source root.');
	}
	return absolute;
}

function normalizeRoots(value) {
	if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
		throw new TypeError('Boost header closure roots must be a bounded nonempty array.');
	}
	const roots = value.map((entry) => normalizeHeaderPath(entry));
	if (new Set(roots).size !== roots.length) throw new RangeError('Boost header closure roots must be unique.');
	return roots;
}

function normalizeHeaderPath(value) {
	if (typeof value !== 'string' || !value.startsWith('boost/') || value.includes('\\')
		|| value.includes('\0') || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
		throw new TypeError('Boost header closure contains a noncanonical path.');
	}
	return value;
}

function closedRecord(value, keys, name) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	const actual = Object.keys(value);
	if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} must have its exact closed fields.`);
	}
	return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const sourceRoot = process.argv[2];
	const roots = process.argv.slice(3);
	const closure = await collectBoostHeaderClosure(sourceRoot, roots);
	process.stdout.write(`${JSON.stringify(closure, null, 2)}\n`);
}
