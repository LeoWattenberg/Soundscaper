/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reads one private regular file against an initial, closed byte-length snapshot. */

import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';

export interface BoundedRegularFileHandle {
	stat(): Promise<Readonly<{ readonly size: number; isFile(): boolean }>>;
	read(
		buffer: Uint8Array, offset: number, length: number, position: number,
	): Promise<Readonly<{ readonly bytesRead: number }>>;
	close(): Promise<void>;
}

export type BoundedRegularFileResult =
	| Readonly<{ readonly status: 'available'; readonly bytes: Uint8Array }>
	| Readonly<{ readonly status: 'unavailable'; readonly reason: 'invalid' | 'limit' | 'missing' }>;

export interface BoundedRegularFileReadOptions {
	readonly openFile?: (path: string, flags: number) => Promise<BoundedRegularFileHandle>;
}

export async function readBoundedRegularFile(
	path: string,
	maximumBytes: number,
	options: BoundedRegularFileReadOptions = {},
): Promise<BoundedRegularFileResult> {
	if (typeof path !== 'string' || path.length < 1 || path.length > 4_096 || path.includes('\0')
		|| !Number.isSafeInteger(maximumBytes) || maximumBytes < 1
		|| options.openFile !== undefined && typeof options.openFile !== 'function') {
		throw new TypeError('The bounded regular-file read request is invalid.');
	}
	const openFile = options.openFile ?? openRegularFile;
	let handle: BoundedRegularFileHandle;
	try { handle = await openFile(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW); }
	catch (error) { return unavailable(errorCode(error) === 'ENOENT' ? 'missing' : 'invalid'); }
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile() || !Number.isSafeInteger(metadata.size)) return unavailable('invalid');
		if (metadata.size > maximumBytes) return unavailable('limit');
		if (metadata.size < 1) return unavailable('missing');
		const bytes = new Uint8Array(metadata.size);
		let offset = 0;
		while (offset < bytes.byteLength) {
			const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
			if (!Number.isSafeInteger(read.bytesRead) || read.bytesRead < 1
				|| read.bytesRead > bytes.byteLength - offset) break;
			offset += read.bytesRead;
		}
		if (offset !== metadata.size) return unavailable('invalid');
		const overflow = new Uint8Array(1);
		if ((await handle.read(overflow, 0, 1, metadata.size)).bytesRead > 0) return unavailable('limit');
		const finalMetadata = await handle.stat();
		if (!finalMetadata.isFile() || finalMetadata.size !== metadata.size) return unavailable('invalid');
		return Object.freeze({ status: 'available', bytes });
	} catch { return unavailable('invalid'); }
	finally { await handle.close().catch(() => undefined); }
}

async function openRegularFile(path: string, flags: number): Promise<BoundedRegularFileHandle> {
	return await open(path, flags) as unknown as BoundedRegularFileHandle;
}

function unavailable(
	reason: 'invalid' | 'limit' | 'missing',
): Extract<BoundedRegularFileResult, { readonly status: 'unavailable' }> {
	return Object.freeze({ status: 'unavailable', reason });
}

function errorCode(error: unknown): string {
	return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}
