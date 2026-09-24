/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError } from '../../i18n/presentation-message.ts';
import type { TemporaryExportCopy, TemporaryFileSink } from '../controller/export/temporary-export.ts';

const EXPORT_DIRECTORY_NAME = 'audio-editor-exports';
const EXPORT_FILE_LOCK_PREFIX = 'audio-editor-export-file:';

export async function openTemporaryExportDirectory(): Promise<FileSystemDirectoryHandle | null> {
	const storage = globalThis.navigator?.storage as StorageManager & {
		getDirectory?(): Promise<FileSystemDirectoryHandle>;
	} | undefined;
	if (typeof storage?.getDirectory !== 'function') return null;
	const root = await storage.getDirectory();
	return root.getDirectoryHandle(EXPORT_DIRECTORY_NAME, { create: true });
}

export function temporaryExportStorageName(name: string): string {
	return `${globalThis.crypto.randomUUID()}-${name}`;
}

/** Keep a live export out of another tab's startup recovery until its cleanup runs. */
export async function acquireTemporaryExportLease(name: string): Promise<() => Promise<void>> {
	const locks = globalThis.navigator?.locks;
	if (!locks?.request) return async () => undefined;
	let grant: () => void = () => undefined;
	let rejectGrant: (error: unknown) => void = () => undefined;
	let release: () => void = () => undefined;
	const acquired = new Promise<void>((resolve, reject) => {
		grant = resolve;
		rejectGrant = reject;
	});
	const held = new Promise<void>((resolve) => { release = resolve; });
	const request = locks.request(`${EXPORT_FILE_LOCK_PREFIX}${name}`, async () => {
		grant();
		await held;
	});
	void request.catch(rejectGrant);
	await acquired;
	return async () => { release(); await request; };
}

export async function createTemporaryFileSink(name: string, copy: TemporaryExportCopy): Promise<TemporaryFileSink> {
	let directory: FileSystemDirectoryHandle | null = null;
	let handle: FileSystemFileHandle | null = null;
	let writable: FileSystemWritableFileStream | null = null;
	let releaseLease: (() => Promise<void>) | null = null;
	let storageName = name;
	const chunks: Uint8Array[] = [];
	let queue = Promise.resolve();
	let closed = false;
	let scheduledByteLength = 0;
	try {
		directory = await openTemporaryExportDirectory();
		if (directory) {
			storageName = temporaryExportStorageName(name);
			releaseLease = await acquireTemporaryExportLease(storageName);
		}
		handle = await directory?.getFileHandle?.(storageName, { create: true }) || null;
		writable = await handle?.createWritable?.() || null;
		if (handle && !writable) throw new Error('Temporary export storage did not provide a writable file.');
	} catch {
		try {
			await writable?.abort?.();
			if (directory && handle) await directory.removeEntry(storageName);
		} catch {
			// Best-effort cleanup after OPFS setup fails.
		}
		await releaseLease?.();
		directory = null;
		handle = null;
		writable = null;
	}
	return {
		persistent: Boolean(writable),
		write(chunk): Promise<void> {
			if (closed) throw createLocalizedError(Error, copy, 'temporaryExportClosed');
			const bytes = Uint8Array.from(toUint8Array(chunk));
			const position = scheduledByteLength;
			scheduledByteLength = addSafeByteLengths(scheduledByteLength, bytes.byteLength);
			if (writable) {
				queue = queue.then(() => writable!.write({ type: 'write', position, data: bytes }));
			}
			else queue = queue.then(() => { chunks.push(bytes); });
			return queue;
		},
		writeAt(position, chunk): Promise<void> {
			if (closed) throw createLocalizedError(Error, copy, 'temporaryExportClosed');
			const bytes = Uint8Array.from(toUint8Array(chunk));
			validateWriteRange(position, bytes.byteLength, scheduledByteLength);
			if (writable) {
				queue = queue.then(() => writable!.write({ type: 'write', position, data: bytes }));
			} else {
				queue = queue.then(() => { patchChunks(chunks, position, bytes); });
			}
			return queue;
		},
		async close(mimeType): Promise<Blob> {
			if (closed) throw createLocalizedError(Error, copy, 'temporaryExportClosed');
			closed = true;
			await queue;
			if (writable && handle) {
				await writable.close();
				const file = await handle.getFile();
				const { registerFileBackedExport } = await import('../file-backed-audio-export.ts');
				return registerFileBackedExport(file.type === mimeType ? file : file.slice(0, file.size, mimeType));
			}
			return new Blob(chunks as BlobPart[], { type: mimeType });
		},
		async remove(): Promise<void> {
			try {
				if (directory && handle) await directory.removeEntry(storageName);
			} catch {
				// Already removed.
			} finally { await releaseLease?.(); }
		},
		async abort(): Promise<void> {
			closed = true;
			queue = queue.catch(() => undefined);
			await queue;
			try {
				await writable?.abort?.();
			} catch {
				// The writer may already be closed.
			}
			try {
				if (directory && handle) await directory.removeEntry(storageName);
			} catch {
				// Already removed.
			} finally { await releaseLease?.(); }
		},
	};
}

function toUint8Array(input: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	return new Uint8Array(input);
}

function addSafeByteLengths(left: number, right: number): number {
	if (!Number.isSafeInteger(right) || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
		throw new RangeError('Temporary export size exceeds JavaScript\'s safe-integer range.');
	}
	return left + right;
}

function validateWriteRange(position: number, byteLength: number, availableByteLength: number): void {
	if (!Number.isSafeInteger(position) || position < 0
		|| position > availableByteLength
		|| byteLength > availableByteLength - position) {
		throw new RangeError('Positioned writes must stay within bytes already written to the temporary export.');
	}
}

function patchChunks(chunks: readonly Uint8Array[], position: number, bytes: Uint8Array): void {
	let chunkStart = 0;
	let sourceOffset = 0;
	for (const chunk of chunks) {
		const chunkEnd = chunkStart + chunk.byteLength;
		if (position < chunkEnd && sourceOffset < bytes.byteLength) {
			const destinationOffset = Math.max(0, position - chunkStart);
			const copyLength = Math.min(chunk.byteLength - destinationOffset, bytes.byteLength - sourceOffset);
			chunk.set(bytes.subarray(sourceOffset, sourceOffset + copyLength), destinationOffset);
			sourceOffset += copyLength;
			position += copyLength;
		}
		chunkStart = chunkEnd;
		if (sourceOffset === bytes.byteLength) return;
	}
}
