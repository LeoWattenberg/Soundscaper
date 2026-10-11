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
	isAvailable?(): boolean;
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

interface WorkerAbortResult {
	readonly removed?: unknown;
}

interface WorkerSnapshotResult {
	readonly size?: unknown;
	readonly file?: unknown;
}

type WorkerOutcome = { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: unknown; readonly nativeTerminal: boolean };
interface OwnedWorkerRequest {
	readonly worker: OpfsWorkerLike;
	readonly settle: (outcome: WorkerOutcome) => void;
}
interface OwnedWorkerWork {
	readonly normal: Promise<WorkerOutcome>;
	readonly terminal: Promise<WorkerOutcome>;
	readonly retire: (outcome: WorkerOutcome) => void;
}

const SIGNAL_ABORTED = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const SIGNAL_REASON = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const ADD_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_LISTENER = EventTarget.prototype.removeEventListener;

let nextRequestId = 1;

/** Capability-detected request client for the dedicated synchronous OPFS worker. */
export class OpfsSyncWorkerClient implements OpfsSyncStoragePort {
	readonly #workerName: string;
	readonly #workerFactory: (workerName: string) => OpfsWorkerLike;
	readonly #broker: WorkerRequestBroker;
	readonly #pendingWriterOpens = new Map<string, string>();
	readonly #ownedWriterRequests = new Map<string, OwnedWorkerRequest>();
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

	isAvailable(): boolean {
		return !this.#closed && this.#supported && this.#worker !== null;
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
		if (signal && Reflect.apply(SIGNAL_ABORTED, signal, []) === true) throw Reflect.apply(SIGNAL_REASON, signal, []);
		const worker = this.#worker!;
		const requestId = createWorkerRequestId('opfs', nextRequestId++);
		let cancelled = false, posted = false;
		let reason: unknown;
		const cancel = () => {
			if (cancelled) return;
			cancelled = true; reason = Reflect.apply(SIGNAL_REASON, signal, []);
			if (posted) try { worker.postMessage({ type: 'cancel', id: requestId }); } catch { /* A worker fault retires ownership. */ }
		};
		let writerId: string;
		try {
			if (signal) {
				Reflect.apply(ADD_LISTENER, signal, ['abort', cancel, { once: true }]);
				if (Reflect.apply(SIGNAL_ABORTED, signal, []) === true) cancel();
			}
			if (cancelled) throw reason;
			this.#pendingWriterOpens.set(requestId, path); posted = true;
			const request = this.#ownedWriterRequest({ type: 'open-writer', operationId, path }, requestId);
			let outcome = await request.normal;
			// A broker deadline cannot retire a cancelled native acquisition.
			if (cancelled) outcome = await request.terminal;
			if (!outcome.ok) {
				request.retire(outcome);
				if (!cancelled) throw outcome.error;
				if (!outcome.nativeTerminal) throw new AggregateError([reason, outcome.error],
					'OPFS worker acquisition terminated before reclamation.', { cause: reason });
				await this.#reclaimCancelledWriter(path, null, reason);
				throw reason;
			}
			const result = outcome.value as WorkerOpenResult | null;
			const identity = typeof result?.writerId === 'string' && result.writerId ? result.writerId : null;
			if (!identity) {
				const error = new Error('OPFS worker returned an invalid writer identity.');
				this.#failWorker(worker, error);
				if (cancelled) throw new AggregateError([reason, error], 'OPFS worker acquisition failed.', { cause: reason });
				throw error;
			}
			writerId = identity;
			if (cancelled) { await this.#reclaimCancelledWriter(path, writerId, reason); throw reason; }
		} finally {
			if (signal) Reflect.apply(REMOVE_LISTENER, signal, ['abort', cancel]);
		}
		let state: 'open' | 'closed' | 'aborted' = 'open';
		let aborting: Promise<void> | null = null;
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
			abort: (): Promise<void> => {
				if (aborting) return aborting;
				if (state !== 'open') return Promise.resolve();
				state = 'aborted';
				// Cache before dispatch so reentry joins the same physical cleanup.
				aborting = Promise.resolve().then(() => this.#reclaimWriter(path, writerId));
				return aborting;
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
		const error = new Error('OPFS synchronous worker is closed.');
		this.#retireWriterRequests(error);
		this.#broker.dispose(error);
		this.#pendingWriterOpens.clear();
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
		requestId?: string,
	): Promise<Result> {
		const worker = this.#worker;
		if (!worker) return Promise.reject(new Error('OPFS synchronous worker is unavailable.'));
		const id = requestId ?? createWorkerRequestId('opfs', nextRequestId++);
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

	#ownedWriterRequest(message: Record<string, unknown>, id = createWorkerRequestId('opfs', nextRequestId++)): OwnedWorkerWork {
		const worker = this.#worker;
		if (!worker) {
			const outcome: WorkerOutcome = { ok: false, error: new Error('OPFS synchronous worker is unavailable.'), nativeTerminal: false };
			return { normal: Promise.resolve(outcome), terminal: Promise.resolve(outcome), retire: () => undefined };
		}
		let settle!: (outcome: WorkerOutcome) => void;
		const terminal = new Promise<WorkerOutcome>(resolve => { settle = resolve; });
		this.#ownedWriterRequests.set(id, { worker, settle });
		const normal = this.#broker.request({ id, post: () => {
			try { worker.postMessage({ id, ...message }); }
			catch (error) {
				this.#pendingWriterOpens.delete(id);
				this.#settleWriterRequest(id, { ok: false, error, nativeTerminal: false }); throw error;
			}
		} }).then((value): WorkerOutcome => ({ ok: true, value }), (error: unknown): WorkerOutcome => ({ ok: false, error, nativeTerminal: false }));
		return { normal, terminal, retire: (outcome: WorkerOutcome) => { this.#settleWriterRequest(id, outcome); } };
	}

	#settleWriterRequest(id: string, outcome: WorkerOutcome): boolean {
		const request = this.#ownedWriterRequests.get(id);
		if (!request) return false;
		this.#ownedWriterRequests.delete(id); request.settle(outcome); return true;
	}

	#retireWriterRequests(error: unknown): void {
		for (const id of this.#ownedWriterRequests.keys()) this.#settleWriterRequest(id, { ok: false, error, nativeTerminal: false });
	}

	async #reclaimWriter(path: string, writerId: string | null): Promise<void> {
		if (writerId !== null) {
			const aborted = await this.#ownedWriterRequest({ type: 'abort-writer', writerId }).terminal;
			if (!aborted.ok) throw aborted.error;
			const result = aborted.value as WorkerAbortResult | null;
			if (result?.removed === true) return;
			// A cancelled close can finish in the worker before caller delivery.
			if (result?.removed !== false) throw new Error('OPFS worker returned an invalid reclamation result.');
		}
		const removed = await this.#ownedWriterRequest({ type: 'remove', path }).terminal;
		if (!removed.ok) throw removed.error;
		if ((removed.value as WorkerAbortResult | null)?.removed !== true) throw new Error('OPFS worker did not acknowledge path removal.');
	}

	async #reclaimCancelledWriter(path: string, writerId: string | null, reason: unknown): Promise<void> {
		let failure: { readonly error: unknown } | null = null;
		try { await this.#reclaimWriter(path, writerId); } catch (error) { failure = { error }; }
		// Native cancellation remains primary; cleanup is a distinct retained member.
		if (failure) throw new AggregateError([reason, failure.error], 'Cancelled OPFS writer reclamation failed.', { cause: reason });
	}

	#handleMessage(worker: OpfsWorkerLike, value: unknown): void {
		if (worker !== this.#worker || !value || typeof value !== 'object') return;
		const response = value as WorkerResponse;
		if (typeof response.id !== 'string') return;
		const request = this.#ownedWriterRequests.get(response.id);
		if (request && request.worker !== worker) return;
		if (response.type === 'result') {
			const owned = this.#settleWriterRequest(response.id, { ok: true, value: response.result });
			if (this.#broker.resolve(response.id, response.result) || owned) {
				this.#pendingWriterOpens.delete(response.id);
			} else this.#reclaimLateWriterOpen(worker, response.id, response.result);
		} else if (response.type === 'error') {
			this.#pendingWriterOpens.delete(response.id);
			const error = deserializeOpfsWorkerError(response.error);
			this.#settleWriterRequest(response.id, { ok: false, error, nativeTerminal: true });
			this.#broker.reject(response.id, error);
		}
		else {
			if (this.#ownedWriterRequests.has(response.id)) { this.#failWorker(worker, new Error('OPFS worker returned an invalid response.')); return; }
			this.#pendingWriterOpens.delete(response.id);
			this.#broker.reject(response.id, new Error('OPFS worker returned an invalid response.'));
		}
	}

	#reclaimLateWriterOpen(worker: OpfsWorkerLike, requestId: string, value: unknown): void {
		if (!this.#pendingWriterOpens.delete(requestId)) return;
		const result = value && typeof value === 'object' ? value as WorkerOpenResult : null;
		const writerId = typeof result?.writerId === 'string' && result.writerId ? result.writerId : null;
		if (!writerId) return;
		try {
			worker.postMessage({
				id: createWorkerRequestId('opfs', nextRequestId++),
				type: 'abort-writer',
				writerId,
			});
		} catch { /* Late writer reclamation is best effort. */ }
	}

	#failWorker(worker: OpfsWorkerLike, error: unknown): void {
		if (worker !== this.#worker) return;
		this.#supported = false;
		this.#retireWriterRequests(error);
		this.#broker.rejectAll(error);
		this.#pendingWriterOpens.clear();
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
