/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';
import type { BlobLike } from './media-records.ts';
import type { OpfsSyncRepositoryBridge } from './opfs-sync-repository-bridge.ts';
import { normalizeOpfsWorkerPath, type OpfsSyncOperationId } from './opfs-sync-worker-protocol.ts';

const throwIfAborted = createAbortGuard('Audio storage was cancelled.');
const nativeExceptionName = Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')!.get!;

/** Path identity exists before any file creation; the caller owns durable cleanup. */
export interface OpfsBlobWritePlan {
	readonly path: string;
	readonly directory: FileSystemDirectoryHandle;
	write(blob: BlobLike): Promise<void>;
}

export function createOpfsBlobWritePlan(
	directory: FileSystemDirectoryHandle,
	prefix: string,
	bridge: OpfsSyncRepositoryBridge,
	{ signal, operationId = 'media-asset-chunk-write' }: Readonly<{
		signal?: AbortSignal; operationId?: OpfsSyncOperationId;
	}> = {},
): OpfsBlobWritePlan {
	const stem = String(prefix || 'media').replace(/[^a-z0-9._-]+/giu, '-').slice(0, 80);
	const random = globalThis.crypto?.randomUUID?.()
		?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	const path = normalizeOpfsWorkerPath(`${stem}-asset-${random.replace(/[^a-z0-9._-]+/giu, '-')}.blob`);
	let entered = false;
	return Object.freeze({
		path,
		directory,
		async write(blob: BlobLike): Promise<void> {
			if (entered) throw new Error('An OPFS Blob write plan can only be used once.');
			entered = true;
			throwIfAborted(signal);
			// A route that fails after admission must not silently fall back over its owned path.
			if (await bridge.available(directory)) {
				throwIfAborted(signal);
				if (!await bridge.writeBlob(directory, operationId, path, blob, signal)) {
					throw new Error('The admitted OPFS worker Blob write did not complete.');
				}
				throwIfAborted(signal);
				return;
			}
			let writable: FileSystemWritableFileStream | undefined;
			let closed = false;
			try {
				throwIfAborted(signal);
				const handle = await directory.getFileHandle(path, { create: true });
				throwIfAborted(signal);
				writable = await handle.createWritable();
				throwIfAborted(signal);
				await writable.write(blob as Blob);
				throwIfAborted(signal);
				await writable.close();
				closed = true;
				throwIfAborted(signal);
			} catch (error) {
				let abortFailure: unknown;
				let abortFailed = false;
				try { if (!closed) await writable?.abort(); } catch (failure) { abortFailure = failure; abortFailed = true; }
				if (abortFailed) throw new AggregateError(
					[error, abortFailure], 'OPFS Blob write and stream abort both failed.', { cause: error },
				);
				throw error;
			}
		},
	});
}

/** An arbitrary error named NotFoundError cannot certify physical absence. */
export async function deleteOpfsBlobPathExact(
	directory: FileSystemDirectoryHandle | null,
	bridge: OpfsSyncRepositoryBridge,
	pathValue: string,
): Promise<void> {
	const path = normalizeOpfsWorkerPath(pathValue);
	if (path !== path.trim() || path.split('').some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
		throw new TypeError('An exact OPFS deletion requires a valid path.');
	}
	if (!directory?.getFileHandle || !directory.removeEntry) {
		throw new Error('The exact OPFS deletion backend is unavailable.');
	}
	let removalFailure: unknown;
	let removalFailed = false;
	try {
		if (!await bridge.remove(directory, path)) await directory.removeEntry(path);
	} catch (error) { removalFailure = error; removalFailed = true; }
	let verificationFailure: unknown;
	let verificationFailed = false;
	try { await directory.getFileHandle(path); }
	catch (error) { verificationFailure = error; verificationFailed = true; }
	if (verificationFailed) {
		if (nativeNotFound(verificationFailure)) return;
		if (removalFailed) throw new AggregateError(
			[removalFailure, verificationFailure], 'Exact OPFS deletion could not verify its result.', { cause: removalFailure },
		);
		throw verificationFailure;
	}
	if (removalFailed) throw removalFailure;
	throw new Error('Exact OPFS deletion left its referenced path present.');
}

function nativeNotFound(error: unknown): boolean {
	try { return Reflect.apply(nativeExceptionName, error, []) === 'NotFoundError'; }
	catch { return false; }
}
