/* SPDX-License-Identifier: AGPL-3.0-only */

import { WorkerRequestBroker } from '../worker-request-broker.ts';
import { createWorkerRequestId } from '../worker-protocol.ts';
import {
	assertOpfsSyncOperationId,
	deserializeOpfsWorkerError,
	normalizeOpfsReadRange,
	normalizeOpfsWorkerPath,
	type OpfsSyncOperationId,
} from './opfs-sync-worker-protocol.ts';

export const DEFAULT_OPFS_WORKER_NAME = 'soundscaper-opfs-storage';

export interface OpfsWorkerLike {
	postMessage(message: unknown, transfer?: readonly Transferable[]): void;
	addEventListener(type: string, listener: (event: MessageEvent) => void): void;
	terminate(): void;
}

export interface OpfsSyncWorkerClientOptions {
	readonly workerName?: string;
	readonly workerFactory?: (workerName: string) => OpfsWorkerLike;
	readonly timeoutMs?: number;
}

export interface OpfsSyncReadResult {
	readonly size: number;
	readonly bytes: Uint8Array;
}

export interface OpfsSyncWriter {
	write(bytes: Uint8Array, signal?: AbortSignal): Promise<void>;
	close(signal?: AbortSignal): Promise<void>;
	abort(): Promise<void>;
}

export interface OpfsSyncStoragePort {
	initialize(directory: FileSystemDirectoryHandle): Promise<boolean>;
	read(
		operationId: OpfsSyncOperationId,
		path: string,
		range: Readonly<{ offset: number; length: number }>,
		signal?: AbortSignal,
	): Promise<OpfsSyncReadResult>;
	snapshot(operationId: OpfsSyncOperationId, path: string, signal?: AbortSignal): Promise<Blob>;
	openWriter(operationId: OpfsSyncOperationId, path: string, signal?: AbortSignal): Promise<OpfsSyncWriter>;
	remove(path: string): Promise<void>;
	close(): void;
}

interface WorkerResponse {
	readonly id?: unknown;
	readonly type?: unknown;
	readonly result?: unknown;
	readonly error?: unknown;
}

interface WorkerReadResult {
	readonly size?: unknown;
	readonly bytes?: unknown;
}

interface WorkerOpenResult {
	readonly writerId?: unknown;
}

interface WorkerSnapshotResult {
	readonly size?: unknown;
	readonly file?: unknown;
}

let nextRequestId = 1;

/** Capability-detected request client for the dedicated synchronous OPFS worker. */
export class OpfsSyncWorkerClient implements OpfsSyncStoragePort {
	readonly #workerName: string;
	readonly #workerFactory: (workerName: string) => OpfsWorkerLike;
	readonly #broker: WorkerRequestBroker;
	#worker: OpfsWorkerLike | null = null;
	#initializePromise: Promise<boolean> | null = null;
	#supported = false;
	#closed = false;

	constructor(options: OpfsSyncWorkerClientOptions = {}) {
		this.#workerName = options.workerName ?? DEFAULT_OPFS_WORKER_NAME;
		this.#workerFactory = options.workerFactory ?? defaultWorkerFactory;
		this.#broker = new WorkerRequestBroker({ timeoutMs: options.timeoutMs });
	}

	initialize(directory: FileSystemDirectoryHandle): Promise<boolean> {
		if (this.#closed) return Promise.resolve(false);
		if (!this.#initializePromise) this.#initializePromise = this.#initialize(directory);
		return this.#initializePromise;
	}

	async read(
		operationId: OpfsSyncOperationId,
		pathValue: string,
		rangeValue: Readonly<{ offset: number; length: number }>,
		signal?: AbortSignal,
	): Promise<OpfsSyncReadResult> {
		assertOpfsSyncOperationId(operationId);
		if (!operationId.endsWith('-read')) throw new TypeError('An OPFS read operation id is required.');
		const path = normalizeOpfsWorkerPath(pathValue);
		const range = normalizeOpfsReadRange(rangeValue?.offset, rangeValue?.length);
		this.#assertSupported();
		const result = await this.#request<WorkerReadResult>({
			type: 'read', operationId, path, ...range,
		}, signal);
		const size = Number(result?.size);
		const bytes = exactBytes(result?.bytes);
		if (!Number.isSafeInteger(size) || size < 0 || bytes.byteLength !== range.length
			|| range.offset + range.length > size) {
			throw new Error('OPFS worker returned an invalid bounded read.');
		}
		return Object.freeze({ size, bytes });
	}

	async openWriter(
		operationId: OpfsSyncOperationId,
		pathValue: string,
		signal?: AbortSignal,
	): Promise<OpfsSyncWriter> {
		assertOpfsSyncOperationId(operationId);
		if (!operationId.endsWith('-write')) throw new TypeError('An OPFS write operation id is required.');
		const path = normalizeOpfsWorkerPath(pathValue);
		this.#assertSupported();
		const result = await this.#request<WorkerOpenResult>({
			type: 'open-writer', operationId, path,
		}, signal);
		const writerId = typeof result?.writerId === 'string' && result.writerId ? result.writerId : null;
		if (!writerId) throw new Error('OPFS worker returned an invalid writer identity.');
		let state: 'open' | 'closed' | 'aborted' = 'open';
		return Object.freeze({
			write: async (bytes: Uint8Array, writeSignal?: AbortSignal): Promise<void> => {
				if (state !== 'open') throw new Error('The OPFS synchronous writer is closed.');
				const payload = copiedBuffer(bytes);
				await this.#request({ type: 'write', writerId, bytes: payload }, writeSignal, [payload]);
			},
			close: async (closeSignal?: AbortSignal): Promise<void> => {
				if (state !== 'open') return;
				await this.#request({ type: 'close-writer', writerId }, closeSignal);
				state = 'closed';
			},
			abort: async (): Promise<void> => {
				if (state !== 'open') return;
				state = 'aborted';
				await this.#request({ type: 'abort-writer', writerId });
			},
		});
	}

	async snapshot(
		operationId: OpfsSyncOperationId,
		pathValue: string,
		signal?: AbortSignal,
	): Promise<Blob> {
		assertOpfsSyncOperationId(operationId);
		if (!operationId.endsWith('-read')) throw new TypeError('An OPFS read operation id is required.');
		const path = normalizeOpfsWorkerPath(pathValue);
		this.#assertSupported();
		const result = await this.#request<WorkerSnapshotResult>({
			type: 'snapshot', operationId, path,
		}, signal);
		const size = Number(result?.size);
		if (!(result?.file instanceof Blob)
			|| !Number.isSafeInteger(size)
			|| size < 0
			|| result.file.size !== size) {
			throw new Error('OPFS worker returned an invalid file snapshot.');
		}
		return result.file;
	}

	async remove(pathValue: string): Promise<void> {
		const path = normalizeOpfsWorkerPath(pathValue);
		this.#assertSupported();
		await this.#request({ type: 'remove', path });
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#supported = false;
		this.#broker.dispose(new Error('OPFS synchronous worker is closed.'));
		this.#terminateWorker();
	}

	async #initialize(directory: FileSystemDirectoryHandle): Promise<boolean> {
		try {
			const worker = this.#workerFactory(this.#workerName);
			if (!worker || typeof worker.postMessage !== 'function') return false;
			this.#worker = worker;
			worker.addEventListener('message', (event) => this.#handleMessage(worker, event.data));
			worker.addEventListener('error', (event) => this.#failWorker(
				worker,
				(event as unknown as ErrorEvent).error
					|| new Error((event as unknown as ErrorEvent).message || 'OPFS worker failed.'),
			));
			worker.addEventListener('messageerror', () => this.#failWorker(
				worker,
				new Error('OPFS worker sent an unreadable message.'),
			));
			const result = await this.#request<{ readonly supported?: unknown }>({
				type: 'initialize', directory,
			});
			this.#supported = result?.supported === true;
			if (!this.#supported) this.#terminateWorker();
			return this.#supported;
		} catch {
			this.#supported = false;
			this.#terminateWorker();
			return false;
		}
	}

	#request<Result = unknown>(
		message: Record<string, unknown>,
		signal?: AbortSignal,
		transfer: readonly Transferable[] = [],
	): Promise<Result> {
		const worker = this.#worker;
		if (!worker) return Promise.reject(new Error('OPFS synchronous worker is unavailable.'));
		const id = createWorkerRequestId('opfs', nextRequestId++);
		return this.#broker.request<Result>({
			id,
			signal,
			abortError: () => abortError(signal),
			onAbort: () => {
				try { worker.postMessage({ type: 'cancel', id }); } catch { /* Cancellation is best effort. */ }
			},
			post: () => worker.postMessage({ id, ...message }, transfer),
		});
	}

	#handleMessage(worker: OpfsWorkerLike, value: unknown): void {
		if (worker !== this.#worker || !value || typeof value !== 'object') return;
		const response = value as WorkerResponse;
		if (typeof response.id !== 'string') return;
		if (response.type === 'result') this.#broker.resolve(response.id, response.result);
		else if (response.type === 'error') this.#broker.reject(
			response.id,
			deserializeOpfsWorkerError(response.error),
		);
		else this.#broker.reject(response.id, new Error('OPFS worker returned an invalid response.'));
	}

	#failWorker(worker: OpfsWorkerLike, error: unknown): void {
		if (worker !== this.#worker) return;
		this.#supported = false;
		this.#broker.rejectAll(error);
		this.#terminateWorker();
	}

	#terminateWorker(): void {
		const worker = this.#worker;
		this.#worker = null;
		try { worker?.terminate(); } catch { /* Worker termination is best effort. */ }
	}

	#assertSupported(): void {
		if (!this.#supported || !this.#worker) throw new Error('OPFS synchronous worker is unavailable.');
	}
}

function defaultWorkerFactory(workerName: string): OpfsWorkerLike {
	if (typeof Worker !== 'function') throw new Error('OPFS Web Worker is unavailable in this environment.');
	return new Worker(new URL('./opfs-sync-worker.ts', import.meta.url), {
		type: 'module',
		name: workerName,
	});
}

function exactBytes(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
	}
	throw new Error('OPFS worker returned invalid bytes.');
}

function copiedBuffer(bytes: Uint8Array): ArrayBuffer {
	if (!(bytes instanceof Uint8Array)) throw new TypeError('OPFS worker writes require Uint8Array bytes.');
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function abortError(signal?: AbortSignal): Error {
	if (signal?.reason instanceof Error) return signal.reason;
	const error = new Error('OPFS worker request was cancelled.');
	error.name = 'AbortError';
	return error;
}
