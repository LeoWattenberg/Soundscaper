/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	cp,
	lstat,
	mkdir,
	readFile,
	readdir,
	readlink,
	realpath,
	writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The filesystem rules the nightly-tests payload is staged under.
 *
 * The payload is copied out of the checkout and shipped, so a link that escapes its source
 * root, a device node, or a write over an existing file would each put something in the
 * bundle that nobody chose to ship. Every read and copy here therefore refuses rather than
 * repairs: the staging fails and says which entry was wrong, instead of silently producing
 * a payload whose contents cannot be accounted for.
 */

export async function assertSafeTree(root, label, options = {}) {
	const excludedRootNames = options.excludedRootNames ?? new Set();
	const canonicalRoot = await realpath(root);
	await visit(root, '');

	async function visit(path, relativePath) {
		const metadata = await lstat(path);
		if (metadata.isSymbolicLink()) {
			if (!options.allowContainedSymlinks) throw new Error(`${label} contains a symbolic link: ${relativePath || '.'}`);
			const target = await readlink(path);
			if (isAbsolute(target)) throw new Error(`${label} symbolic link must be relative: ${relativePath}`);
			const lexicalTarget = resolve(dirname(path), target);
			if (!isPathInside(root, lexicalTarget) && lexicalTarget !== root) {
				throw new Error(`${label} symbolic link leaves its source root: ${relativePath}`);
			}
			let canonicalTarget;
			try {
				canonicalTarget = await realpath(path);
			} catch (error) {
				throw new Error(`${label} contains an unresolved symbolic link: ${relativePath}`, { cause: error });
			}
			if (!isPathInside(canonicalRoot, canonicalTarget) && canonicalTarget !== canonicalRoot) {
				throw new Error(`${label} symbolic link leaves its canonical source root: ${relativePath}`);
			}
			return;
		}
		if (metadata.isFile()) return;
		if (!metadata.isDirectory()) throw new Error(`${label} contains a non-file entry: ${relativePath || '.'}`);
		for (const entry of await readdir(path, { withFileTypes: true })) {
			if (!relativePath && excludedRootNames.has(entry.name)) continue;
			await visit(join(path, entry.name), relativePath ? `${relativePath}/${entry.name}` : entry.name);
		}
	}
}

export async function copyTree(source, destination, options = {}) {
	const sourceMetadata = await lstat(source);
	await mkdir(dirname(destination), { recursive: true });
	if (sourceMetadata.isFile()) {
		await cp(source, destination, { force: false, errorOnExist: true });
		return;
	}
	const excludedRootNames = options.excludedRootNames ?? new Set();
	await cp(source, destination, {
		recursive: true,
		force: false,
		errorOnExist: true,
		verbatimSymlinks: true,
		filter: (candidate) => {
			const relativePath = relative(source, candidate);
			if (!relativePath) return true;
			return !excludedRootNames.has(relativePath.split(sep)[0]);
		},
	});
}

export function assertSafeOutput({ root, output, browsers }) {
	const buildRoot = join(root, '.desktop-build');
	if (!isPathInside(buildRoot, output)) {
		throw new Error('Nightly test output must be a proper descendant of the repository .desktop-build directory.');
	}
	if (output === browsers || isPathInside(output, browsers) || isPathInside(browsers, output)) {
		throw new Error('Nightly test output cannot overlap its browser source.');
	}
}

export async function assertSafeOutputPath(path) {
	let candidate = path;
	while (true) {
		try {
			const metadata = await lstat(candidate);
			if (metadata.isSymbolicLink()) {
				throw new Error(`Nightly test output path contains a symbolic link: ${candidate}`);
			}
			if (candidate !== path && !metadata.isDirectory()) {
				throw new Error(`Nightly test output parent is not a directory: ${candidate}`);
			}
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		const parent = dirname(candidate);
		if (parent === candidate) return;
		candidate = parent;
	}
}

export async function assertDirectory(path, label) {
	let metadata;
	try {
		metadata = await lstat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new Error(`Required ${label} is missing: ${path}`, { cause: error });
		throw error;
	}
	if (metadata.isSymbolicLink()) throw new Error(`Required ${label} cannot be a symbolic link: ${path}`);
	if (!metadata.isDirectory()) throw new Error(`Required ${label} is not a directory: ${path}`);
}

export async function assertRegularFile(path, label) {
	let metadata;
	try {
		metadata = await lstat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new Error(`Required ${label} is missing: ${path}`, { cause: error });
		throw error;
	}
	if (metadata.isSymbolicLink()) throw new Error(`Required ${label} cannot be a symbolic link: ${path}`);
	if (!metadata.isFile()) throw new Error(`Required ${label} is not a regular file: ${path}`);
}

export async function readRequiredJson(path, label) {
	await assertRegularFile(path, label);
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		throw new Error(`${label} is not valid JSON: ${path}`, { cause: error });
	}
}

export function resolveRequiredPath(value, label) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Nightly test ${label} is required.`);
	return resolve(value);
}

export function isPathInside(root, candidate) {
	const path = relative(root, candidate);
	return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function hashFile(path) {
	return new Promise((resolvePromise, reject) => {
		const hash = createHash('sha256');
		const stream = createReadStream(path);
		stream.on('error', reject);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolvePromise(hash.digest('hex')));
	});
}

export function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

export async function writeJson(path, value) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
