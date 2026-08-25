/* SPDX-License-Identifier: AGPL-3.0-only */

import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Prefer a source archive shipped in the corresponding-source bundle. Without
 * an explicitly selected bundle, let the owning build script perform its
 * existing URL, redirect, signature, and digest checks.
 */
export async function readBundledCodecSourceInput({
	archiveDirectory = process.env.SOUNDSCAPER_CODEC_SOURCE_DIRECTORY ?? '',
	fileName,
	maximumBytes,
	readRemote,
}) {
	assertFileName(fileName);
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
		throw new TypeError('Bundled codec source maximum byte length is invalid.');
	}
	if (typeof readRemote !== 'function') {
		throw new TypeError('Bundled codec source remote acquisition is invalid.');
	}
	if (archiveDirectory === '') return boundedBytes(await readRemote(), maximumBytes);
	if (typeof archiveDirectory !== 'string' || archiveDirectory.includes('\0')
		|| !isAbsolute(archiveDirectory)) {
		throw new TypeError('Bundled codec source directory is invalid.');
	}
	const root = resolve(archiveDirectory);
	const source = resolve(root, fileName);
	if (source !== root && !source.startsWith(`${root}${sep}`)) {
		throw new Error('Bundled codec source path leaves its declared directory.');
	}
	const metadata = await lstat(source);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new Error(`Bundled codec source is not a regular file: ${fileName}`);
	}
	const realRoot = await realpath(root);
	const realSource = await realpath(source);
	if (!realSource.startsWith(`${realRoot}${sep}`)) {
		throw new Error('Bundled codec source path leaves its real directory.');
	}
	return boundedBytes(await readFile(source), maximumBytes);
}

function boundedBytes(value, maximumBytes) {
	if (!(value instanceof Uint8Array) || value.byteLength === 0) {
		throw new Error('Bundled codec source input is empty or invalid.');
	}
	if (value.byteLength > maximumBytes) {
		throw new Error(`Bundled codec source input exceeds ${String(maximumBytes)} bytes.`);
	}
	return value;
}

function assertFileName(value) {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(value)
		|| value === '.' || value === '..') {
		throw new TypeError('Bundled codec source filename is invalid.');
	}
}
