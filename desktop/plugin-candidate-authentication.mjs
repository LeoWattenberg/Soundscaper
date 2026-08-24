/* SPDX-License-Identifier: AGPL-3.0-only */

/** Canonical no-follow authentication for a plug-in file or bundle tree. */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const PLUGIN_BUNDLE_DIGEST_ALGORITHM = 'soundscaper-plugin-bundle-sha256-v1';
const MAXIMUM_FILES = 100_000;
const MAXIMUM_FILE_BYTES = 4 * 1024 ** 3;
const MAXIMUM_TOTAL_BYTES = 16 * 1024 ** 3;
const MAXIMUM_DEPTH = 32;
const MAXIMUM_PATH_BYTES = 4_096;
const BUFFER_BYTES = 1024 * 1024;

export async function authenticatePluginCandidate(pathValue) {
	if (typeof pathValue !== 'string' || !isAbsolute(pathValue) || resolve(pathValue) !== pathValue) {
		throw new TypeError('A plug-in candidate path must be absolute and normalized.');
	}
	const root = pathValue;
	const before = await entryIdentity(root);
	if (await realpath(root) !== root) throw new Error('A plug-in candidate must be one canonical non-symbolic path.');
	if (before.kind === 'file') {
		const measured = await hashRegularFile(root, before);
		const after = await entryIdentity(root);
		if (!sameEntry(before, after)) throw new Error('The plug-in file changed while it was authenticated.');
		return Object.freeze({
			kind: 'file', byteLength: measured.byteLength, sha256: measured.sha256,
			fileCount: 1, identity: Object.freeze({ dev: after.dev, ino: after.ino }),
		});
	}
	if (before.kind !== 'directory') throw new Error('A plug-in candidate must be a file or bundle directory.');
	const first = await collectBundle(root);
	if (first.length === 0) throw new Error('A plug-in bundle cannot be empty.');
	const files = [];
	let byteLength = 0;
	const identities = new Set();
	for (const entry of first) {
		const key = `${String(entry.identity.dev)}:${String(entry.identity.ino)}`;
		if (identities.has(key)) throw new Error('A plug-in bundle cannot contain hard-linked aliases.');
		identities.add(key);
		const measured = await hashRegularFile(entry.path, entry.identity);
		byteLength += measured.byteLength;
		if (byteLength > MAXIMUM_TOTAL_BYTES) throw new Error('The plug-in bundle exceeds its byte budget.');
		files.push(Object.freeze({ path: entry.name, ...measured }));
	}
	const second = await collectBundle(root);
	const after = await entryIdentity(root);
	if (!sameEntry(before, after) || inventory(first) !== inventory(second)) {
		throw new Error('The plug-in bundle changed while it was authenticated.');
	}
	const hash = createHash('sha256');
	hash.update(`${PLUGIN_BUNDLE_DIGEST_ALGORITHM}\0`);
	for (const file of files) {
		hash.update(`${file.path}\0${String(file.byteLength)}\0${file.sha256}\n`);
	}
	return Object.freeze({
		kind: 'bundle', byteLength, sha256: hash.digest('hex'), fileCount: files.length,
		identity: Object.freeze({ dev: after.dev, ino: after.ino }),
	});
}

async function collectBundle(root) {
	const files = [];
	const folded = new Set();
	async function visit(directory, depth) {
		if (depth > MAXIMUM_DEPTH) throw new Error('The plug-in bundle exceeds its directory-depth budget.');
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
		for (const entry of entries) {
			portableSegment(entry.name);
			const path = resolve(directory, entry.name);
			const name = relative(root, path).split('\\').join('/');
			if (Buffer.byteLength(name) > MAXIMUM_PATH_BYTES) throw new Error('A plug-in bundle path is too long.');
			const caseKey = name.normalize('NFC').toLocaleLowerCase('en-US');
			if (folded.has(caseKey)) throw new Error(`The plug-in bundle has a case-colliding path: ${name}.`);
			folded.add(caseKey);
			const identity = await entryIdentity(path);
			if (identity.kind === 'directory') await visit(path, depth + 1);
			else if (identity.kind === 'file') {
				files.push(Object.freeze({ path, name, identity }));
				if (files.length > MAXIMUM_FILES) throw new Error('The plug-in bundle has too many files.');
			} else throw new Error(`The plug-in bundle contains a symbolic or special entry: ${name}.`);
		}
	}
	await visit(root, 0);
	files.sort((left, right) => left.name.localeCompare(right.name, 'en'));
	return files;
}

async function hashRegularFile(path, expected) {
	if (expected.byteLength > MAXIMUM_FILE_BYTES) throw new Error('A plug-in bundle file exceeds its byte budget.');
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const opened = identityFrom(await handle.stat());
		if (opened.kind !== 'file' || !sameEntry(expected, opened)) {
			throw new Error('A plug-in bundle file changed while it was opened.');
		}
		const hash = createHash('sha256');
		const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
		let byteLength = 0;
		for (;;) {
			const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
			if (bytesRead === 0) break;
			byteLength += bytesRead;
			if (byteLength > expected.byteLength) throw new Error('A plug-in bundle file grew while it was read.');
			hash.update(buffer.subarray(0, bytesRead));
		}
		const after = identityFrom(await handle.stat());
		if (byteLength !== expected.byteLength || !sameEntry(opened, after)) {
			throw new Error('A plug-in bundle file changed while it was read.');
		}
		return Object.freeze({ byteLength, sha256: hash.digest('hex') });
	} finally { await handle.close(); }
}

async function entryIdentity(path) { return identityFrom(await lstat(path)); }
function identityFrom(metadata) {
	const kind = metadata.isSymbolicLink() ? 'symbolic'
		: metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'special';
	return Object.freeze({
		kind,
		dev: Number(metadata.dev), ino: Number(metadata.ino), byteLength: Number(metadata.size),
		mtimeMs: metadata.mtimeMs, ctimeMs: metadata.ctimeMs,
	});
}
function sameEntry(left, right) {
	return left.kind === right.kind && left.dev === right.dev && left.ino === right.ino
		&& left.byteLength === right.byteLength && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
function inventory(entries) {
	return JSON.stringify(entries.map(({ name, identity }) => [
		name, identity.kind, identity.dev, identity.ino, identity.byteLength, identity.mtimeMs, identity.ctimeMs,
	]));
}
function portableSegment(value) {
	if (value === '' || value === '.' || value === '..' || [...value].some((character) => {
		const code = character.codePointAt(0); return code <= 0x1f || code === 0x7f || character === '/' || character === '\\';
	})
		|| /[. ]$/u.test(value) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(value)) {
		throw new Error(`The plug-in bundle contains a non-portable path segment: ${value}.`);
	}
}
