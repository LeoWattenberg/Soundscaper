/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	WorkerBrokerDisposedError,
	WorkerRequestCancelledError,
	WorkerRequestTimeoutError,
} from './worker-protocol.ts';

export const DEFAULT_WORKER_REQUEST_TIMEOUT_MS = 120_000;
const MAXIMUM_WORKER_REQUEST_TIMEOUT_MS = 30 * 60 * 1_000;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type ErrorFactory<Arguments extends readonly unknown[]> = (...args: Arguments) => unknown;

export interface WorkerRequestBrokerOptions {
	readonly timeoutMs?: number;
	readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle;
	readonly clearTimeout?: (handle: TimerHandle) => void;
}

export interface WorkerRequestOptions<Context = unknown> {
	readonly id: string;
	readonly context?: Context;
	readonly signal?: AbortSignal | null;
	readonly timeoutMs?: number;
	readonly post?: () => void;
	readonly onAbort?: () => void;
	readonly onTimeout?: (error: Error) => void;
	readonly abortError?: ErrorFactory<[]>;
	readonly timeoutError?: ErrorFactory<[number]>;
}

export interface WorkerRequestEntry<Context = unknown> {
	readonly id: string;
	readonly context: Context | undefined;
	readonly signal: AbortSignal | null;
}

interface MutableWorkerRequestEntry extends WorkerRequestEntry {
	readonly resolve: (result: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly onAbortEffect: (() => void) | null;
	readonly abortError?: ErrorFactory<[]>;
	readonly onTimeout: ((error: Error) => void) | null;
	readonly timeoutError?: ErrorFactory<[number]>;
	readonly timeoutMs: number;
	onAbort: () => void;
	timer: TimerHandle | null;
}

/**
 * Exactly-once lifecycle shared by request/response worker clients. Domain
 * clients retain message interpretation while this broker owns registration,
 * post rollback, cancellation, progress-reset deadlines, and settlement.
 */
export class WorkerRequestBroker {
	readonly defaultTimeoutMs: number;
	readonly entries = new Map<string, MutableWorkerRequestEntry>();
	readonly setTimeout: (callback: () => void, delay: number) => TimerHandle;
	readonly clearTimeout: (handle: TimerHandle) => void;
	disposed = false;

	constructor(options: WorkerRequestBrokerOptions = {}) {
		this.defaultTimeoutMs = normalizeWorkerRequestTimeout(
			options.timeoutMs ?? DEFAULT_WORKER_REQUEST_TIMEOUT_MS,
		);
		this.setTimeout = options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
		this.clearTimeout = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle));
	}

	get size(): number { return this.entries.size; }

	has(id: string): boolean { return this.entries.has(id); }

	get<Context = unknown>(id: string): Readonly<WorkerRequestEntry<Context>> | null {
		return (this.entries.get(id) as MutableWorkerRequestEntry & WorkerRequestEntry<Context> | undefined) || null;
	}

	values(): IterableIterator<Readonly<WorkerRequestEntry>> { return this.entries.values(); }

	request<Result = unknown, Context = unknown>(options: WorkerRequestOptions<Context>): Promise<Result> {
		const id = String(options.id || '');
		if (!id) return Promise.reject(new TypeError('A worker request id is required.'));
		if (this.disposed) return Promise.reject(new WorkerBrokerDisposedError());
		if (this.entries.has(id)) return Promise.reject(new Error(`Worker request ${id} is already pending.`));
		const timeoutMs = normalizeWorkerRequestTimeout(options.timeoutMs ?? this.defaultTimeoutMs);
		const signal = options.signal || null;
		if (signal?.aborted) return Promise.reject(errorFrom(options.abortError, createAbortError));

		return new Promise<Result>((resolve, reject) => {
			const entry: MutableWorkerRequestEntry = {
				id,
				resolve: (result) => resolve(result as Result),
				reject,
				context: options.context,
				signal,
				onAbort: () => undefined,
				onAbortEffect: options.onAbort || null,
				abortError: options.abortError,
				onTimeout: options.onTimeout || null,
				timeoutError: options.timeoutError,
				timeoutMs,
				timer: null,
			};
			entry.onAbort = () => this.#abort(entry);
			this.entries.set(id, entry);
			signal?.addEventListener('abort', entry.onAbort, { once: true });
			this.#arm(entry);
			if (signal?.aborted) {
				this.#abort(entry);
				return;
			}
			try {
				options.post?.();
			} catch (error) {
				this.reject(id, error);
			}
		});
	}

	touch(id: string): boolean {
		const entry = this.entries.get(id);
		if (!entry) return false;
		this.#arm(entry);
		return true;
	}

	resolve(id: string, result: unknown): boolean {
		return this.#settle(id, null, result);
	}

	reject(id: string, error: unknown): boolean {
		return this.#settle(id, error instanceof Error ? error : new Error(String(error)));
	}

	rejectAll(error: unknown): void {
		for (const id of [...this.entries.keys()]) this.reject(id, error);
	}

	dispose(error: Error = new WorkerBrokerDisposedError()): void {
		if (this.disposed) return;
		this.disposed = true;
		this.rejectAll(error);
	}

	#arm(entry: MutableWorkerRequestEntry): void {
		if (entry.timer != null) this.clearTimeout(entry.timer);
		entry.timer = this.setTimeout(() => {
			if (!this.entries.has(entry.id)) return;
			entry.timer = null;
			const error = errorFrom(entry.timeoutError, createTimeoutError, entry.timeoutMs);
			const settled = this.reject(entry.id, error);
			if (settled) {
				try { entry.onTimeout?.(error); } catch { /* Cancellation is best effort. */ }
			}
		}, entry.timeoutMs);
		unrefTimer(entry.timer);
	}

	#abort(entry: MutableWorkerRequestEntry): void {
		if (!this.entries.has(entry.id)) return;
		const settled = this.reject(entry.id, errorFrom(entry.abortError, createAbortError));
		if (settled) {
			try { entry.onAbortEffect?.(); } catch { /* Cancellation is best effort. */ }
		}
	}

	#settle(id: string, error: Error | null, result?: unknown): boolean {
		const entry = this.entries.get(id);
		if (!entry) return false;
		this.entries.delete(id);
		if (entry.timer != null) this.clearTimeout(entry.timer);
		entry.timer = null;
		entry.signal?.removeEventListener('abort', entry.onAbort);
		if (error) entry.reject(error);
		else entry.resolve(result);
		return true;
	}
}

export function normalizeWorkerRequestTimeout(value: unknown): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1 || number > MAXIMUM_WORKER_REQUEST_TIMEOUT_MS) {
		throw new RangeError(`Worker request timeout must be between 1 and ${MAXIMUM_WORKER_REQUEST_TIMEOUT_MS} milliseconds.`);
	}
	return number;
}

function errorFrom<Arguments extends readonly unknown[]>(
	factory: ErrorFactory<Arguments> | undefined,
	fallback: (...args: Arguments) => Error,
	...args: Arguments
): Error {
	if (typeof factory !== 'function') return fallback(...args);
	try {
		const error = factory(...args);
		return error instanceof Error ? error : fallback(...args);
	} catch {
		return fallback(...args);
	}
}

function createAbortError(): Error {
	return new WorkerRequestCancelledError();
}

function createTimeoutError(timeoutMs: number): Error {
	return new WorkerRequestTimeoutError(timeoutMs);
}

function unrefTimer(timer: TimerHandle): void {
	const candidate: unknown = timer;
	if (!candidate || typeof candidate !== 'object' || !('unref' in candidate)) return;
	const unref = (candidate as { readonly unref?: unknown }).unref;
	if (typeof unref === 'function') unref.call(candidate);
}
