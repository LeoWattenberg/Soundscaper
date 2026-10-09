/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { zipSync } from 'fflate';

const execute = promisify(execFile);
const MAXIMUM_SOURCE_BYTES = 512 * 1024 * 1024;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;
const SHA256 = /^[a-f\d]{64}$/u;

/** Publish one source download while preserving each authenticated inner archive. */
export async function stageDesktopReleaseSources({
	repositoryRoot, sourceRevision, sourceInputsRoot, outputRoot, inputs,
}) {
	if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/u.test(String(sourceRevision))) {
		throw new Error('The release source revision must be an exact Git commit.');
	}
	const files = new Map();
	let totalBytes = 0;
	for (const input of inputs) {
		if (!SAFE_NAME.test(String(input.name)) || typeof input.bundlePath !== 'string'
			|| !input.bundlePath.split('/').every((part) => SAFE_NAME.test(part))
			|| !/^(?:sdk|bundled-codecs)\//u.test(input.bundlePath)) {
			throw new Error('The release source archive path is invalid.');
		}
		const bytes = await readAuthenticatedArchive(resolve(sourceInputsRoot, input.name), input);
		const previous = files.get(input.bundlePath);
		if (previous && !previous.equals(bytes)) {
			throw new Error(`Release source archives conflict at ${input.bundlePath}.`);
		}
		if (!previous) {
			files.set(input.bundlePath, bytes);
			totalBytes += bytes.byteLength;
			if (totalBytes > MAXIMUM_SOURCE_BYTES) throw new Error('Release source bytes exceed the archive budget.');
		}
	}
	const { stdout: applicationBytes } = await execute('git', [
		'archive', '--format=zip', '--prefix=application/', sourceRevision,
	], { cwd: repositoryRoot, encoding: 'buffer', maxBuffer: MAXIMUM_SOURCE_BYTES });
	files.set('application.zip', applicationBytes);
	if (totalBytes + applicationBytes.byteLength > MAXIMUM_SOURCE_BYTES) {
		throw new Error('Release source bytes exceed the archive budget.');
	}
	const ordered = [...files.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
	const manifest = {
		schemaVersion: 1,
		sourceRevision,
		purpose: 'application-and-authenticated-desktop-corresponding-source',
		files: ordered.map(([path, bytes]) => ({ path, ...descriptor(bytes) })),
	};
	const entries = Object.fromEntries(ordered);
	entries['SOURCE_MANIFEST.json'] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
	entries['README.md'] = Buffer.from([
		'# Release sources', '',
		`Application source revision: ${sourceRevision}.`, '',
		'Extract application.zip for the complete committed repository, including native build recipes, patches, and license notices.',
		'Extract the ZIPs under bundled-codecs/ for the codec sources, authenticated upstream archives, and rebuild instructions.',
		'The sdk/ directory retains the exact authenticated upstream SDK source archives. Extract them when following the native build recipes.',
		'SOURCE_MANIFEST.json records the byte length and SHA-256 digest of every inner archive.', '',
	].join('\n'));
	// Inner ZIPs and upstream archives already carry their own compression and
	// file modes. Store them intact with a fixed DOS timestamp in the outer ZIP.
	const bytes = Buffer.from(zipSync(entries, { level: 0, mtime: new Date(1980, 0, 1) }));
	await writeFile(resolve(outputRoot, 'sources.zip'), bytes, { flag: 'wx', mode: 0o444 });
	return { name: 'sources.zip', ...descriptor(bytes) };
}

async function readAuthenticatedArchive(path, input) {
	if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 1
		|| input.byteLength > MAXIMUM_SOURCE_BYTES || !SHA256.test(String(input.sha256))) {
		throw new Error('Release source archive bytes or digest authority is invalid.');
	}
	const metadata = await lstat(path);
	if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== input.byteLength) {
		throw new Error('Release source input is not a regular file with the authenticated bytes.');
	}
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try {
		const bytes = await handle.readFile();
		if (bytes.byteLength !== input.byteLength || descriptor(bytes).sha256 !== input.sha256) {
			throw new Error('Release source input digest disagrees with its authenticated bytes.');
		}
		return bytes;
	} finally {
		await handle.close();
	}
}

function descriptor(bytes) {
	return { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
