/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, type FileHandle } from 'node:fs/promises';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

import type { DesktopLibraryMedia } from './project-library-contract.ts';

export class DesktopLibraryMediaBodyIntegrityError extends Error {}

export async function writeDeclaredMediaBody(
	handle: FileHandle,
	chunks: AsyncIterable<Uint8Array>,
	descriptor: DesktopLibraryMedia,
	maximumChunkBytes: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	const hash = createHash('sha256');
	let byteLength = 0;
	for await (const chunk of chunks) {
		throwIfAborted(signal);
		if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) {
			throw new TypeError('Desktop library managed-media chunk must be a non-empty Uint8Array');
		}
		if (chunk.byteLength > maximumChunkBytes) {
			throw new RangeError('Desktop library managed-media chunk exceeds its byte limit');
		}
		if (chunk.byteLength > descriptor.byteLength - byteLength) {
			throw new RangeError('Desktop library managed-media body exceeds its declared byte length');
		}
		const ownedChunk = Uint8Array.from(chunk);
		hash.update(ownedChunk);
		await writeExactly(handle, ownedChunk, byteLength, signal);
		byteLength += ownedChunk.byteLength;
	}
	if (byteLength !== descriptor.byteLength) {
		throw new RangeError('Desktop library managed-media body ended before its declared byte length');
	}
	if (hash.digest('hex') !== descriptor.sha256) {
		throw new Error('Desktop library managed-media SHA-256 does not match its declaration');
	}
}

export async function readMediaBodyExactly(
	handle: FileHandle,
	bytes: Uint8Array,
	position: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		throwIfAborted(signal);
		const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, position + offset);
		if (bytesRead <= 0) {
			throw new DesktopLibraryMediaBodyIntegrityError(
				'Desktop library managed-media body ended during a bounded read',
			);
		}
		offset += bytesRead;
	}
}

export async function verifyDesktopLibraryMediaBodyPath(
	path: string,
	descriptor: DesktopLibraryMedia,
	maximumChunkBytes: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	const handle = await openRegularMediaBody(path);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size !== descriptor.byteLength) {
			throw new DesktopLibraryMediaBodyIntegrityError(
				'Desktop library managed-media body does not match its immutable descriptor',
			);
		}
		const hash = createHash('sha256');
		const buffer = new Uint8Array(Math.min(maximumChunkBytes, Math.max(1, descriptor.byteLength)));
		let offset = 0;
		while (offset < descriptor.byteLength) {
			throwIfAborted(signal);
			const view = buffer.subarray(0, Math.min(buffer.byteLength, descriptor.byteLength - offset));
			await readMediaBodyExactly(handle, view, offset, signal);
			hash.update(view);
			offset += view.byteLength;
		}
		if (hash.digest('hex') !== descriptor.sha256) {
			throw new DesktopLibraryMediaBodyIntegrityError(
				'Desktop library managed-media body does not match its immutable SHA-256 descriptor',
			);
		}
	} finally {
		await handle.close();
	}
}

export function absoluteManagedMediaRoot(value: unknown): string {
	if (typeof value !== 'string' || value.includes('\0') || !isAbsolute(value)) {
		throw new TypeError('Desktop library managed-media root must be an absolute path without NUL bytes');
	}
	return normalize(value);
}

export function assertManagedMediaDescendant(root: string, candidate: string): void {
	const child = relative(resolve(root), resolve(candidate));
	if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
		throw new TypeError('Desktop library managed-media path leaves its fixed scope');
	}
}

export async function mediaPathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isMissingFileError(error)) return false;
		throw error;
	}
}

export async function createRealMediaDirectory(directory: string): Promise<void> {
	try {
		await mkdir(directory, { mode: 0o700 });
	} catch (error) {
		if (!isAlreadyExistsError(error)) throw error;
	}
	await assertRealMediaDirectory(directory);
}

export async function assertRealMediaDirectory(directory: string): Promise<void> {
	const stat = await lstat(directory);
	if (!stat.isDirectory() || stat.isSymbolicLink()) {
		throw new TypeError('Desktop library managed-media scope contains a non-directory component');
	}
}

export async function openRegularMediaBody(path: string): Promise<FileHandle> {
	const entry = await lstat(path);
	if (!entry.isFile() || entry.isSymbolicLink()) {
		throw new DesktopLibraryMediaBodyIntegrityError(
			'Desktop library managed-media body is not a regular file',
		);
	}
	const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
	const handle = await open(path, flags);
	try {
		if (!(await handle.stat()).isFile()) {
			throw new DesktopLibraryMediaBodyIntegrityError(
				'Desktop library managed-media body is not a regular file',
			);
		}
		return handle;
	} catch (error) {
		await handle.close();
		throw error;
	}
}

export async function syncMediaDirectory(directory: string): Promise<void> {
	if (process.platform === 'win32') return;
	const handle = await open(directory, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

export function isMissingFileError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExistsError(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

async function writeExactly(
	handle: FileHandle,
	bytes: Uint8Array,
	position: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		throwIfAborted(signal);
		const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset);
		if (bytesWritten <= 0) throw new Error('Desktop library managed-media stage write made no progress');
		offset += bytesWritten;
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	signal?.throwIfAborted();
}
