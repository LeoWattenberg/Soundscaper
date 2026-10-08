/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';
import { blobWithMimeType, normalizeBlob, type BlobLike, type StorageRecord } from './media-records.ts';

export type OpfsBinaryInspection = Readonly<
	{ status: 'present'; body: BlobLike }
	| { status: 'missing'; reason: 'directory' | 'file' | 'inline-blob' }
>;

export interface OpfsBinaryInspectionBackend {
	readonly preferOpfs: boolean;
	readonly storageManager?: StorageManager | null;
	readonly opfsRoot?: FileSystemDirectoryHandle | null;
	readonly opfsDirectoryName: string;
}

const throwIfAborted = createAbortGuard('Binary storage inspection was cancelled.');
const ABSENT = Symbol('absent existing OPFS entry');
const domExceptionName = typeof DOMException === 'function'
	? Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')?.get : undefined;

/** Read existing binary custody without directory creation, worker fallback or body materialization. */
export async function inspectOpfsBinaryRecord(
	record: StorageRecord,
	backend: OpfsBinaryInspectionBackend,
	signal?: AbortSignal,
): Promise<OpfsBinaryInspection> {
	throwIfAborted(signal);
	const storage = record.storage;
	// Ordinary media and binary-cache writers publish these two layouts. Chunked
	// and unknown representations require their own owner; they prove no absence here.
	if (storage !== 'opfs' && storage !== 'indexeddb-blob') {
		throw new TypeError('Unsupported binary storage layout for inspection.');
	}
	const mimeType = record.mimeType;
	if (storage === 'indexeddb-blob') {
		const body = record.blob;
		if (body === undefined || body === null) return missing('inline-blob');
		return present(normalizeBlob(body), mimeType, signal);
	}
	const path = record.path;
	if (typeof path !== 'string' || !path || path.length > 512) {
		throw new TypeError('Binary inspection requires a bounded existing OPFS path.');
	}
	if (!backend.preferOpfs) throw unavailable();
	const root = backend.opfsRoot ?? await nativeAwait(() => {
		if (typeof backend.storageManager?.getDirectory !== 'function') throw unavailable();
		return backend.storageManager.getDirectory();
	}, signal);
	if (typeof root?.getDirectoryHandle !== 'function') throw unavailable();
	const directory = await existingNative(
		() => root.getDirectoryHandle(backend.opfsDirectoryName, { create: false }), signal,
	);
	if (directory === ABSENT) return missing('directory');
	if (typeof directory?.getFileHandle !== 'function') throw unavailable();
	const handle = await existingNative(() => directory.getFileHandle(path, { create: false }), signal);
	if (handle === ABSENT) return missing('file');
	if (typeof handle?.getFile !== 'function') throw unavailable();
	const body = await existingNative(() => handle.getFile(), signal);
	if (body === ABSENT) return missing('file');
	return present(normalizeBlob(body), mimeType, signal);
}

function present(body: BlobLike, mimeType: unknown, signal?: AbortSignal): OpfsBinaryInspection {
	const output = blobWithMimeType(body, mimeType);
	throwIfAborted(signal);
	return Object.freeze({ status: 'present', body: output });
}

function missing(reason: 'directory' | 'file' | 'inline-blob'): OpfsBinaryInspection {
	return Object.freeze({ status: 'missing', reason });
}

function unavailable(): Error { return new Error('The binary OPFS inspection backend is unavailable.'); }

/** Keep the native operation owned until it settles, even when cancellation arrives meanwhile. */
async function nativeAwait<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	throwIfAborted(signal);
	try {
		const value = await operation();
		throwIfAborted(signal);
		return value;
	} catch (error) {
		throwIfAborted(signal);
		throw error;
	}
}

async function existingNative<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T | typeof ABSENT> {
	try { return await nativeAwait(operation, signal); }
	catch (error) {
		throwIfAborted(signal);
		// Native branding excludes Error/object name spoofing and hostile own name getters.
		try { if (domExceptionName?.call(error) === 'NotFoundError') return ABSENT; }
		catch { /* A non-DOMException is an error, never evidence of absence. */ }
		throw error;
	}
}
