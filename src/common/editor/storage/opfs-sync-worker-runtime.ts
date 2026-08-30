/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertOpfsSyncOperationId,
	MAXIMUM_OPFS_SYNC_CHUNK_BYTES,
	normalizeOpfsReadRange,
	normalizeOpfsWorkerPath,
	type OpfsSyncOperationId,
} from './opfs-sync-worker-protocol.ts';

export { MAXIMUM_OPFS_SYNC_CHUNK_BYTES } from './opfs-sync-worker-protocol.ts';

interface SyncAccessHandleLike {
	getSize(): number;
	read(buffer: ArrayBufferView, options: { readonly at: number }): number;
	write(buffer: ArrayBufferView, options: { readonly at: number }): number;
	truncate(size: number): void;
	flush(): void;
	close(): void;
}

interface SyncFileHandleLike {
	createSyncAccessHandle(options?: { readonly mode?: string }): Promise<SyncAccessHandleLike>;
	getFile(): Promise<Blob>;
}

interface WorkerWriter {
	readonly id: string;
	readonly path: string;
	readonly operationId: OpfsSyncOperationId;
	readonly access: SyncAccessHandleLike;
	offset: number;
}

interface OpfsSyncWorkerRuntimeOptions {
	readonly supportsSyncAccessHandles?: () => boolean;
}

interface WorkerRequest extends Record<string, unknown> {
	readonly id?: unknown;
	readonly type?: unknown;
}

let nextWriterId = 1;

/** Worker-owned synchronous OPFS sessions with one closed operation vocabulary. */
export class OpfsSyncWorkerRuntime {
	readonly #supportsSyncAccessHandles: () => boolean;
	readonly #writers = new Map<string, WorkerWriter>();
	readonly #cancelled = new Set<string>();
	#directory: FileSystemDirectoryHandle | null = null;
	#initialized = false;

	constructor(options: OpfsSyncWorkerRuntimeOptions = {}) {
		this.#supportsSyncAccessHandles = options.supportsSyncAccessHandles
			?? defaultSupportsSyncAccessHandles;
	}

	async handle(value: unknown): Promise<Record<string, unknown>> {
		const request = requestRecord(value);
		const type = typeof request.type === 'string' ? request.type : '';
		const id = requestId(request.id);
		if (type === 'cancel') {
			this.#cancelled.add(id);
			return Object.freeze({ cancelled: true });
		}
		if (type === 'initialize') return this.#initialize(request);
		this.#assertInitialized();
		this.#throwIfCancelled(id);
		try {
			if (type === 'read') return await this.#read(request, id);
			if (type === 'snapshot') return await this.#snapshot(request, id);
			if (type === 'open-writer') return await this.#openWriter(request, id);
			if (type === 'write') return this.#write(request, id);
			if (type === 'close-writer') return this.#closeWriter(request, id);
			if (type === 'abort-writer') return await this.#abortWriter(request, id);
			if (type === 'remove') return await this.#remove(request, id);
			throw new TypeError('A known OPFS worker request type is required.');
		} finally {
			this.#cancelled.delete(id);
		}
	}

	async #snapshot(request: WorkerRequest, requestIdValue: string): Promise<Record<string, unknown>> {
		const operationId = readOperation(request.operationId);
		const path = normalizeOpfsWorkerPath(request.path);
		const fileHandle = await this.#fileHandle(path, false);
		this.#throwIfCancelled(requestIdValue);
		const access = await createSyncAccess(fileHandle, true);
		let size: number;
		try {
			size = access.getSize();
			if (!Number.isSafeInteger(size) || size < 0) {
				throw new Error('OPFS synchronous access returned an invalid file size.');
			}
		} finally {
			access.close();
		}
		this.#throwIfCancelled(requestIdValue);
		const file = await fileHandle.getFile();
		if (!(file instanceof Blob) || file.size !== size) {
			throw new Error('The OPFS file changed during snapshot acquisition.');
		}
		return Object.freeze({ operationId, size, file });
	}

	#initialize(request: WorkerRequest): Record<string, unknown> {
		if (this.#initialized) throw new Error('The OPFS worker is already initialized.');
		this.#initialized = true;
		const supported = this.#supportsSyncAccessHandles();
		const directory = request.directory;
		if (supported && isDirectoryHandle(directory)) this.#directory = directory;
		return Object.freeze({ supported: Boolean(this.#directory) });
	}

	async #read(request: WorkerRequest, requestIdValue: string): Promise<Record<string, unknown>> {
		const operationId = readOperation(request.operationId);
		const path = normalizeOpfsWorkerPath(request.path);
		const { offset, length } = normalizeOpfsReadRange(request.offset, request.length);
		const fileHandle = await this.#fileHandle(path, false);
		this.#throwIfCancelled(requestIdValue);
		const access = await createSyncAccess(fileHandle, true);
		try {
			const size = access.getSize();
			if (!Number.isSafeInteger(size) || size < 0) {
				throw new Error('OPFS synchronous access returned an invalid file size.');
			}
			if (offset + length > size) throw new RangeError('The requested range exceeds the OPFS file.');
			this.#throwIfCancelled(requestIdValue);
			const bytes = new Uint8Array(length);
			const read = access.read(bytes, { at: offset });
			if (read !== length) throw new Error('OPFS synchronous access returned a short read.');
			return Object.freeze({ operationId, size, bytes: bytes.buffer });
		} finally {
			access.close();
		}
	}

	async #openWriter(request: WorkerRequest, requestIdValue: string): Promise<Record<string, unknown>> {
		const operationId = writeOperation(request.operationId);
		const path = normalizeOpfsWorkerPath(request.path);
		const fileHandle = await this.#fileHandle(path, true);
		this.#throwIfCancelled(requestIdValue);
		let access: SyncAccessHandleLike | null = null;
		try {
			access = await createSyncAccess(fileHandle, false);
			this.#throwIfCancelled(requestIdValue);
			access.truncate(0);
			const id = `opfs-writer-${nextWriterId++}`;
			this.#writers.set(id, { id, path, operationId, access, offset: 0 });
			return Object.freeze({ writerId: id });
		} catch (error) {
			try { access?.close(); } catch { /* The failed handle may already be closed. */ }
			try { await this.#directory?.removeEntry(path); } catch { /* Creation may not have reached disk. */ }
			throw error;
		}
	}

	#write(request: WorkerRequest, requestIdValue: string): Record<string, unknown> {
		const writer = this.#writer(request.writerId);
		this.#throwIfCancelled(requestIdValue);
		const bytes = requestBytes(request.bytes);
		if (bytes.byteLength > MAXIMUM_OPFS_SYNC_CHUNK_BYTES) {
			throw new RangeError('A write exceeds the OPFS worker chunk limit.');
		}
		if (!Number.isSafeInteger(writer.offset + bytes.byteLength)) {
			throw new RangeError('The OPFS worker output size is too large.');
		}
		const written = writer.access.write(bytes, { at: writer.offset });
		if (written !== bytes.byteLength) throw new Error('OPFS synchronous access returned a short write.');
		writer.offset += written;
		return Object.freeze({ written });
	}

	#closeWriter(request: WorkerRequest, requestIdValue: string): Record<string, unknown> {
		const writer = this.#writer(request.writerId);
		this.#throwIfCancelled(requestIdValue);
		let flushError: unknown;
		let closeError: unknown;
		try { writer.access.flush(); } catch (error) { flushError = error; }
		try { writer.access.close(); } catch (error) { closeError = error; }
		this.#writers.delete(writer.id);
		if (flushError !== undefined && closeError !== undefined) throw new AggregateError(
			[flushError, closeError], 'OPFS writer flush and close both failed.', { cause: flushError },
		);
		if (flushError !== undefined) throw flushError;
		if (closeError !== undefined) throw closeError;
		return Object.freeze({ size: writer.offset });
	}

	async #abortWriter(request: WorkerRequest, requestIdValue: string): Promise<Record<string, unknown>> {
		const writer = this.#writer(request.writerId);
		this.#throwIfCancelled(requestIdValue);
		this.#writers.delete(writer.id);
		let closeError: unknown;
		try { writer.access.close(); } catch (error) { closeError = error; }
		try {
			await this.#directory?.removeEntry(writer.path);
		} catch (removeError) {
			if (!isNotFoundError(removeError)) {
				if (closeError !== undefined) {
					throw new AggregateError([closeError, removeError], 'OPFS writer abort failed.');
				}
				throw removeError;
			}
		}
		if (closeError !== undefined) throw closeError;
		return Object.freeze({ removed: true });
	}

	async #remove(request: WorkerRequest, requestIdValue: string): Promise<Record<string, unknown>> {
		const path = normalizeOpfsWorkerPath(request.path);
		if ([...this.#writers.values()].some((writer) => writer.path === path)) {
			throw new Error('An active OPFS writer owns the requested path.');
		}
		this.#throwIfCancelled(requestIdValue);
		try {
			await this.#directory?.removeEntry(path);
		} catch (error) {
			if (!isNotFoundError(error)) throw error;
		}
		return Object.freeze({ removed: true });
	}

	async #fileHandle(path: string, create: boolean): Promise<SyncFileHandleLike> {
		const handle = await this.#directory?.getFileHandle(path, { create });
		if (!handle || typeof (handle as unknown as SyncFileHandleLike).createSyncAccessHandle !== 'function') {
			throw new Error('OPFS synchronous access is unavailable.');
		}
		return handle as unknown as SyncFileHandleLike;
	}

	#writer(value: unknown): WorkerWriter {
		const id = typeof value === 'string' ? value : '';
		const writer = this.#writers.get(id);
		if (!writer) throw new Error('An unknown OPFS writer was requested.');
		return writer;
	}

	#assertInitialized(): void {
		if (!this.#directory) throw new Error('The OPFS worker is not initialized.');
	}

	#throwIfCancelled(id: string): void {
		if (!this.#cancelled.has(id)) return;
		const error = new Error('The OPFS worker request was cancelled.');
		error.name = 'AbortError';
		throw error;
	}
}

async function createSyncAccess(
	handle: SyncFileHandleLike,
	readOnly: boolean,
): Promise<SyncAccessHandleLike> {
	return handle.createSyncAccessHandle(readOnly ? { mode: 'read-only' } : undefined);
}

function readOperation(value: unknown): OpfsSyncOperationId {
	assertOpfsSyncOperationId(value);
	if (!value.endsWith('-read')) throw new TypeError('An OPFS read operation id is required.');
	return value;
}

function writeOperation(value: unknown): OpfsSyncOperationId {
	assertOpfsSyncOperationId(value);
	if (!value.endsWith('-write')) throw new TypeError('An OPFS write operation id is required.');
	return value;
}

function requestRecord(value: unknown): WorkerRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An OPFS worker request object is required.');
	}
	return value as WorkerRequest;
}

function requestId(value: unknown): string {
	if (typeof value !== 'string' || !value) throw new TypeError('An OPFS worker request id is required.');
	return value;
}

function requestBytes(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	throw new TypeError('OPFS worker writes require binary bytes.');
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
	return Boolean(value && typeof value === 'object'
		&& typeof (value as { readonly getFileHandle?: unknown }).getFileHandle === 'function'
		&& typeof (value as { readonly removeEntry?: unknown }).removeEntry === 'function');
}

function defaultSupportsSyncAccessHandles(): boolean {
	const scope = globalThis as unknown as {
		readonly FileSystemFileHandle?: { readonly prototype?: { readonly createSyncAccessHandle?: unknown } };
	};
	return typeof scope.FileSystemFileHandle?.prototype?.createSyncAccessHandle === 'function';
}

function isNotFoundError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object'
		&& (error as { readonly name?: unknown }).name === 'NotFoundError');
}
