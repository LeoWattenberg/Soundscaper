/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic, regular-file-only USTAR archives for optional desktop engines. */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

const SHA256 = /^[a-f\d]{64}$/u;
const TARGETS = new Set(['mac-arm64', 'linux-x64', 'linux-arm64', 'win-x64', 'win-arm64']);
const FAMILIES = new Set(['sherpa-onnx-node', 'onnxruntime-node', 'whisper-cpp', 'llama-cpp', 'kokoro-g2p']);
const PUBLIC_BASE = 'https://assets.soundscaper.org/runtime/assistance/';
const MAX_FILES = 16_384;
const MAX_FILE_BYTES = 4 * 1024 ** 3;
const ZERO_BLOCK = Buffer.alloc(512);

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function safePath(path) {
	return typeof path === 'string' && path.length > 0 && !path.startsWith('/')
		&& !path.includes('\\') && !path.includes('\0')
		&& path.split('/').every((part) => part && part !== '.' && part !== '..');
}

function octal(header, start, length, value) {
	const digits = value.toString(8);
	assert(digits.length <= length - 2, 'Assistance archive numeric field is too large.');
	header.write(`${digits.padStart(length - 1, '0')}\0`, start, length, 'ascii');
}

function splitUstarPath(path) {
	const bytes = Buffer.byteLength(path);
	if (bytes <= 100) return { name: path, prefix: '' };
	for (let index = path.lastIndexOf('/'); index > 0; index = path.lastIndexOf('/', index - 1)) {
		const prefix = path.slice(0, index);
		const name = path.slice(index + 1);
		if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
			return { name, prefix };
		}
	}
	throw new Error(`Assistance archive path exceeds USTAR limits: ${path}`);
}

function tarHeader(file) {
	const { name, prefix } = splitUstarPath(file.path);
	const header = Buffer.alloc(512);
	header.write(name, 0, 100, 'utf8');
	octal(header, 100, 8, file.executable ? 0o755 : 0o644);
	octal(header, 108, 8, 0);
	octal(header, 116, 8, 0);
	octal(header, 124, 12, file.byteLength);
	octal(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	header.write('0', 156, 1, 'ascii');
	header.write('ustar\0', 257, 6, 'ascii');
	header.write('00', 263, 2, 'ascii');
	header.write(prefix, 345, 155, 'utf8');
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
	header[154] = 0;
	header[155] = 0x20;
	return header;
}

async function inventory(root) {
	const found = [];
	async function walk(directory, prefix) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			const path = join(directory, entry.name);
			if (entry.isSymbolicLink()) throw new Error(`Assistance archive contains a symlink: ${relative}`);
			if (entry.isDirectory()) await walk(path, relative);
			else if (entry.isFile()) found.push(relative);
			else throw new Error(`Assistance archive contains a special file: ${relative}`);
		}
	}
	await walk(root, '');
	return found.sort();
}

async function hashFile(path, expected) {
	const metadata = await lstat(path);
	assert(metadata.isFile() && !metadata.isSymbolicLink(), 'Assistance archive source is not a regular file.');
	assert(metadata.size === expected.byteLength, `Assistance archive file length changed: ${expected.path}`);
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	assert(hash.digest('hex') === expected.sha256, `Assistance archive file digest changed: ${expected.path}`);
}

async function* tarEntries(root, files) {
	for (const file of files) {
		yield tarHeader(file);
		const hash = createHash('sha256');
		let byteLength = 0;
		for await (const chunk of createReadStream(join(root, file.path))) {
			byteLength += chunk.length;
			assert(byteLength <= file.byteLength, `Assistance archive file grew: ${file.path}`);
			hash.update(chunk);
			yield chunk;
		}
		assert(byteLength === file.byteLength && hash.digest('hex') === file.sha256,
			`Assistance archive source changed while streaming: ${file.path}`);
		const padding = (512 - file.byteLength % 512) % 512;
		if (padding) yield Buffer.alloc(padding);
	}
	yield ZERO_BLOCK;
	yield ZERO_BLOCK;
}

function tarText(header, start, length) {
	return header.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '');
}

function tarNumber(header, start, length) {
	const value = tarText(header, start, length).trim();
	assert(/^[0-7]+$/u.test(value), 'Assistance archive has an invalid USTAR number.');
	return Number.parseInt(value, 8);
}

/** Re-read the completed gzip and prove every tar byte matches the file pins. */
export async function verifyAssistanceRuntimeArchive(path, files) {
	let buffer = Buffer.alloc(0), index = 0, state = 'header', remaining = 0;
	let padding = 0, zeros = 0, hash = null;
	for await (const chunk of createReadStream(path).pipe(createGunzip())) {
		buffer = Buffer.concat([buffer, chunk]);
		while (buffer.length > 0) {
			if (state === 'header') {
				if (buffer.length < 512) break;
				const header = buffer.subarray(0, 512);
				buffer = buffer.subarray(512);
				if (header.every((byte) => byte === 0)) {
					zeros += 1;
					if (zeros === 2) state = 'done';
					continue;
				}
				assert(zeros === 0 && index < files.length,
					'Assistance archive has an unexpected USTAR entry.');
				const file = files[index];
				const name = tarText(header, 0, 100);
				const prefix = tarText(header, 345, 155);
				const entryPath = prefix ? `${prefix}/${name}` : name;
				assert(tarText(header, 257, 6) === 'ustar'
					&& (header[156] === 0 || header[156] === 0x30)
					&& entryPath === file.path
					&& tarNumber(header, 124, 12) === file.byteLength
					&& tarNumber(header, 100, 8) === (file.executable ? 0o755 : 0o644),
					`Assistance archive entry differs from its manifest: ${file.path}`);
				const checksum = tarNumber(header, 148, 8);
				const checksumHeader = Buffer.from(header);
				checksumHeader.fill(0x20, 148, 156);
				assert(checksumHeader.reduce((sum, byte) => sum + byte, 0) === checksum,
					`Assistance archive header checksum differs: ${file.path}`);
				remaining = file.byteLength;
				padding = (512 - remaining % 512) % 512;
				hash = createHash('sha256');
				state = 'body';
				continue;
			}
			if (state === 'body') {
				const length = Math.min(remaining, buffer.length);
				hash.update(buffer.subarray(0, length));
				buffer = buffer.subarray(length);
				remaining -= length;
				if (remaining === 0) {
					assert(hash.digest('hex') === files[index].sha256,
						`Assistance archive body digest differs: ${files[index].path}`);
					state = 'padding';
				}
				continue;
			}
			if (state === 'padding') {
				const length = Math.min(padding, buffer.length);
				assert(buffer.subarray(0, length).every((byte) => byte === 0),
					'Assistance archive has nonzero padding.');
				buffer = buffer.subarray(length);
				padding -= length;
				if (padding === 0) { index += 1; state = 'header'; }
				continue;
			}
			assert(false, 'Assistance archive has bytes after its USTAR end marker.');
		}
	}
	assert(state === 'done' && index === files.length && buffer.length === 0,
		'Assistance archive has an incomplete or unexpected USTAR closure.');
}

async function archiveDigest(path) {
	const hash = createHash('sha256');
	let byteLength = 0;
	for await (const chunk of createReadStream(path)) {
		byteLength += chunk.length;
		hash.update(chunk);
	}
	return { byteLength, sha256: hash.digest('hex') };
}

/** The archive is built only from an exact, already authenticated file closure. */
export async function createAssistanceRuntimeArchive({
	familyId, runtimeVersion, targetId, runtimePrefix, installPath, files, runtimeRoot, archiveRoot,
}) {
	assert(FAMILIES.has(familyId) && TARGETS.has(targetId), 'Assistance archive identity is invalid.');
	assert(typeof runtimeVersion === 'string' && /^[A-Za-z\d][A-Za-z\d._-]*$/u.test(runtimeVersion),
		'Assistance archive version is invalid.');
	assert(safePath(runtimePrefix) && safePath(installPath)
		&& (installPath.startsWith(`${runtimePrefix}/`) || installPath === runtimePrefix),
		'Assistance archive install path is invalid.');
	assert(Array.isArray(files) && files.length > 0 && files.length <= MAX_FILES,
		'Assistance archive file inventory is invalid.');
	const ordered = [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
	assert(new Set(ordered.map(({ path }) => path)).size === ordered.length, 'Assistance archive repeats a file.');
	for (const file of ordered) {
		assert(safePath(file.path) && Number.isSafeInteger(file.byteLength)
			&& file.byteLength >= 0 && file.byteLength <= MAX_FILE_BYTES
			&& SHA256.test(file.sha256) && typeof file.executable === 'boolean',
			'Assistance archive file descriptor is invalid.');
		splitUstarPath(file.path);
	}
	const root = resolve(runtimeRoot, installPath);
	const actual = await inventory(root);
	assert(JSON.stringify(actual) === JSON.stringify(ordered.map(({ path }) => path)),
		'Assistance archive source inventory has missing or unexpected files.');
	for (const file of ordered) await hashFile(join(root, file.path), file);
	const directory = resolve(archiveRoot, familyId, runtimeVersion, targetId);
	await mkdir(directory, { recursive: true });
	const temporary = join(directory, `.archive-${process.pid}-${Date.now()}.tar.gz`);
	try {
		await pipeline(Readable.from(tarEntries(root, ordered)), createGzip({ level: 9, mtime: 0 }),
			createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
		await verifyAssistanceRuntimeArchive(temporary, ordered);
		const archive = await archiveDigest(temporary);
		const archivePath = join(directory, `${archive.sha256}.tar.gz`);
		await rename(temporary, archivePath);
		return Object.freeze({
			archivePath,
			bundle: Object.freeze({
				familyId, runtimeVersion, runtimePrefix, installPath,
				archive: Object.freeze({
					url: `${PUBLIC_BASE}${familyId}/${runtimeVersion}/${targetId}/${archive.sha256}.tar.gz`,
					...archive,
				}),
				files: ordered,
			}),
		});
	} finally {
		await rm(temporary, { force: true });
	}
}
