/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BlobLike } from './media-records.ts';
import {
	OpfsSyncWorkerClient,
	type OpfsSyncStoragePort,
	type OpfsSyncWriter,
} from './opfs-sync-worker-client.ts';
import {
	MAXIMUM_OPFS_SYNC_CHUNK_BYTES,
	type OpfsSyncOperationId,
} from './opfs-sync-worker-protocol.ts';

export interface OpfsSyncRepositoryBridgeOptions {
	readonly client?: OpfsSyncStoragePort | null;
	readonly workerName?: string;
}

/** Optional worker route shared by the OPFS repository's six binary operation classes. */
export class OpfsSyncRepositoryBridge {
	readonly #client: OpfsSyncStoragePort | null;
	#availability: Promise<boolean> | null = null;

	constructor(options: OpfsSyncRepositoryBridgeOptions = {}) {
		this.#client = options.client === undefined
			? new OpfsSyncWorkerClient({ workerName: options.workerName })
			: options.client;
	}

	async snapshot(
		directory: FileSystemDirectoryHandle,
		operationId: OpfsSyncOperationId,
		path: string,
		signal?: AbortSignal,
	): Promise<Blob | null> {
		if (!await this.available(directory)) return null;
		try {
			return await this.#client!.snapshot(operationId, path, signal);
		} catch (error) {
			if (!this.#workerIsAvailable()) return null;
			throw error;
		}
	}

	async readable(
		directory: FileSystemDirectoryHandle,
		operationId: OpfsSyncOperationId,
		path: string,
		signal?: AbortSignal,
	): Promise<BlobLike | null> {
		if (!await this.available(directory)) return null;
		try {
			const initial = await this.#client!.read(operationId, path, { offset: 0, length: 0 }, signal);
			return new OpfsSyncReadableBlob(this.#client!, operationId, path, initial.size, 0, initial.size, signal);
		} catch (error) {
			if (!this.#workerIsAvailable()) return null;
			throw error;
		}
	}

	async writeBlob(
		directory: FileSystemDirectoryHandle,
		operationId: OpfsSyncOperationId,
		path: string,
		blob: BlobLike,
		signal?: AbortSignal,
	): Promise<boolean> {
		if (!await this.available(directory)) return false;
		let writer: OpfsSyncWriter;
		try {
			writer = await this.#client!.openWriter(operationId, path, signal);
		} catch (error) {
			if (!this.#workerIsAvailable()) return false;
			throw error;
		}
		try {
			for (let offset = 0; offset < blob.size; offset += MAXIMUM_OPFS_SYNC_CHUNK_BYTES) {
				throwIfAborted(signal);
				const end = Math.min(blob.size, offset + MAXIMUM_OPFS_SYNC_CHUNK_BYTES);
				const buffer = await blob.slice(offset, end).arrayBuffer();
				throwIfAborted(signal);
				if (buffer.byteLength !== end - offset) throw new Error('An OPFS Blob slice returned the wrong length.');
				await writer.write(new Uint8Array(buffer), signal);
			}
			await writer.close(signal);
			return true;
		} catch (error) {
			let cleanupError: unknown = null;
			try { await writer.abort(); } catch (failure) { cleanupError = failure; }
			if (!this.#workerIsAvailable()) return false;
			if (cleanupError !== null) throw new AggregateError(
				[error, cleanupError], 'OPFS worker Blob write and cleanup both failed.',
			);
			throw error;
		}
	}

	async openWriter(
		directory: FileSystemDirectoryHandle,
		operationId: OpfsSyncOperationId,
		path: string,
		signal?: AbortSignal,
	): Promise<OpfsSyncWriter | null> {
		if (!await this.available(directory)) return null;
		try {
			return await this.#client!.openWriter(operationId, path, signal);
		} catch {
			try { await this.#client!.remove(path); } catch { /* Creation may not have reached disk. */ }
			return null;
		}
	}

	async remove(directory: FileSystemDirectoryHandle, path: string): Promise<boolean> {
		if (!await this.available(directory)) return false;
		try {
			await this.#client!.remove(path);
			return true;
		} catch (error) {
			if (!this.#workerIsAvailable()) return false;
			throw error;
		}
	}

	async available(directory: FileSystemDirectoryHandle): Promise<boolean> {
		if (!this.#client) return false;
		this.#availability ??= this.#client.initialize(directory).catch(() => false);
		return await this.#availability && this.#workerIsAvailable();
	}

	close(): void { this.#client?.close(); }

	#workerIsAvailable(): boolean {
		return this.#client?.isAvailable?.() ?? true;
	}
}

class OpfsSyncReadableBlob implements BlobLike {
	readonly type = '';

	constructor(
		readonly client: OpfsSyncStoragePort,
		readonly operationId: OpfsSyncOperationId,
		readonly path: string,
		readonly fileSize: number,
		readonly start: number,
		readonly size: number,
		readonly signal?: AbortSignal,
	) {}

	slice(startValue = 0, endValue = this.size, contentType = ''): BlobLike {
		const start = sliceIndex(startValue, this.size);
		const end = Math.max(start, sliceIndex(endValue, this.size));
		return new OpfsSyncReadableBlob(
			this.client,
			this.operationId,
			this.path,
			this.fileSize,
			this.start + start,
			end - start,
			this.signal,
		).withType(contentType);
	}

	async arrayBuffer(): Promise<ArrayBuffer> {
		throwIfAborted(this.signal);
		const result = await this.client.read(
			this.operationId,
			this.path,
			{ offset: this.start, length: this.size },
			this.signal,
		);
		if (result.size !== this.fileSize) throw new Error('The OPFS file changed during a bounded read.');
		return exactBuffer(result.bytes);
	}

	withType(type: string): BlobLike {
		if (!type) return this;
		return Object.freeze({
			size: this.size,
			type,
			slice: this.slice.bind(this),
			arrayBuffer: this.arrayBuffer.bind(this),
		});
	}
}

function sliceIndex(value: number, size: number): number {
	const integer = Number.isFinite(value) ? Math.trunc(value) : 0;
	return integer < 0 ? Math.max(size + integer, 0) : Math.min(integer, size);
}

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	const error = new Error('OPFS storage was cancelled.');
	error.name = 'AbortError';
	throw error;
}
