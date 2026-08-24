/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Main-owned pool for the closed native-media portion of helper contract v1.
 * Each slot owns one `HelperSupervisor`, so all binary verification,
 * heartbeat, cancellation, RSS and repeated-crash rules remain at the process
 * boundary. This scheduler contributes only bounded concurrency and FIFO
 * admission: one through four helpers, default two, and one job per helper.
 */

import type { HelperJobKind } from './helper-contract.ts';
import type {
	HelperJobRequest,
	HelperSupervisorSnapshot,
} from './helper-supervisor.ts';

export const NATIVE_MEDIA_HELPER_POOL_DEFAULT_SIZE = 2;
export const NATIVE_MEDIA_HELPER_POOL_MINIMUM_SIZE = 1;
export const NATIVE_MEDIA_HELPER_POOL_MAXIMUM_SIZE = 4;

export const NATIVE_MEDIA_HELPER_POOL_JOB_KINDS = Object.freeze([
	'probe-video-source',
	'media-decode',
	'media-encode',
	'media-render',
	'media-proxy',
] as const satisfies readonly HelperJobKind[]);

export type NativeMediaHelperPoolJobKind =
	(typeof NATIVE_MEDIA_HELPER_POOL_JOB_KINDS)[number];

export type NativeMediaHelperPoolJobRequest =
	HelperJobRequest<NativeMediaHelperPoolJobKind>;

export interface NativeMediaHelperWorkerPort {
	runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown>;
	snapshot(): HelperSupervisorSnapshot;
	clearQuarantine(): void;
	dispose(): void;
}

export type NativeMediaHelperPoolFailureCause =
	| 'cancelled'
	| 'disposed'
	| 'self-test-failed'
	| 'unsupported-operation'
	| 'all-workers-quarantined';

export class NativeMediaHelperPoolError extends Error {
	readonly cause_: NativeMediaHelperPoolFailureCause;

	constructor(cause: NativeMediaHelperPoolFailureCause, message: string) {
		super(message);
		this.name = 'NativeMediaHelperPoolError';
		this.cause_ = cause;
	}
}

export interface NativeMediaHelperPoolSnapshot {
	readonly configuredWorkers: number;
	readonly activeJobs: number;
	readonly queuedJobs: number;
	readonly quarantinedWorkers: number;
	readonly disposed: boolean;
}

export interface NativeMediaHelperPoolOptions {
	readonly size?: number;
	readonly createWorker: (index: number) => NativeMediaHelperWorkerPort;
	/** A worker cannot execute user work until its pinned build passes this. */
	readonly selfTest: (worker: NativeMediaHelperWorkerPort, index: number) => Promise<void>;
}

interface PoolSlot {
	readonly index: number;
	readonly worker: NativeMediaHelperWorkerPort;
	busy: boolean;
	selfTest: 'pending' | 'passed' | 'quarantined';
}

interface QueuedJob {
	readonly request: NativeMediaHelperPoolJobRequest;
	readonly abortListener: (() => void) | null;
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	settled: boolean;
}

export class NativeMediaHelperPool {
	readonly #slots: PoolSlot[];
	readonly #selfTest: NativeMediaHelperPoolOptions['selfTest'];
	readonly #queue: QueuedJob[] = [];
	#disposed = false;

	constructor(options: NativeMediaHelperPoolOptions) {
		const size = options.size ?? NATIVE_MEDIA_HELPER_POOL_DEFAULT_SIZE;
		if (!Number.isSafeInteger(size)
			|| size < NATIVE_MEDIA_HELPER_POOL_MINIMUM_SIZE
			|| size > NATIVE_MEDIA_HELPER_POOL_MAXIMUM_SIZE) {
			throw new RangeError('A native media helper pool must contain between one and four workers.');
		}
		this.#selfTest = options.selfTest;
		this.#slots = Array.from({ length: size }, (_, index) => ({
			index,
			worker: options.createWorker(index),
			busy: false,
			selfTest: 'pending' as const,
		}));
	}

	runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown> {
		if (this.#disposed) return Promise.reject(disposedError());
		if (!(NATIVE_MEDIA_HELPER_POOL_JOB_KINDS as readonly string[]).includes(request.kind)) {
			return Promise.reject(new NativeMediaHelperPoolError(
				'unsupported-operation',
				`Native media helper operation ${String(request.kind)} is outside the closed pool contract.`,
			));
		}
		if (request.signal?.aborted) return Promise.reject(cancelledError());
		return new Promise((resolve, reject) => {
			const job: QueuedJob = {
				request,
				abortListener: request.signal ? () => this.#cancelQueued(job) : null,
				resolve,
				reject,
				settled: false,
			};
			request.signal?.addEventListener('abort', job.abortListener!, { once: true });
			this.#queue.push(job);
			this.#dispatch();
		});
	}

	snapshot(): NativeMediaHelperPoolSnapshot {
		return Object.freeze({
			configuredWorkers: this.#slots.length,
			activeJobs: this.#slots.filter(({ busy }) => busy).length,
			queuedJobs: this.#queue.filter(({ settled }) => !settled).length,
			quarantinedWorkers: this.#slots.filter((slot) => this.#isQuarantined(slot)).length,
			disposed: this.#disposed,
		});
	}

	clearQuarantine(index?: number): void {
		for (const slot of this.#slots) {
			if (index !== undefined && slot.index !== index) continue;
			slot.worker.clearQuarantine();
			slot.selfTest = 'pending';
		}
		this.#dispatch();
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		for (const job of this.#queue.splice(0)) this.#settle(job, disposedError());
		for (const { worker } of this.#slots) worker.dispose();
	}

	#dispatch(): void {
		if (this.#disposed) return;
		for (const slot of this.#slots) {
			if (slot.busy || this.#isQuarantined(slot)) continue;
			const job = this.#nextJob();
			if (!job) return;
			slot.busy = true;
			void this.#execute(slot, job);
		}
		// Every worker quarantined and idle: nothing will ever pick a queued
		// job up short of an explicit quarantine clear, so a job left pending
		// here is a hang — its dispatcher slot stays running with no helper.
		if (this.#slots.every((slot) => !slot.busy && this.#isQuarantined(slot))) {
			for (const job of this.#queue.splice(0)) {
				this.#settle(job, new NativeMediaHelperPoolError('all-workers-quarantined',
					'Every native media helper worker is quarantined.'));
			}
		}
	}

	#nextJob(): QueuedJob | null {
		for (;;) {
			const job = this.#queue.shift();
			if (!job) return null;
			if (!job.settled) return job;
		}
	}

	async #execute(slot: PoolSlot, job: QueuedJob): Promise<void> {
		try {
			if (slot.selfTest === 'pending') {
				try {
					await this.#selfTest(slot.worker, slot.index);
					slot.selfTest = 'passed';
				} catch (error) {
					slot.selfTest = 'quarantined';
					throw new NativeMediaHelperPoolError(
						'self-test-failed',
						`Native media helper ${String(slot.index)} failed its build self-test: ${errorMessage(error)}`,
					);
				}
			}
			if (!job.settled) this.#settle(job, null, await slot.worker.runJob(job.request));
		} catch (error) {
			this.#settle(job, error instanceof Error ? error : new Error(String(error)));
		} finally {
			slot.busy = false;
			this.#dispatch();
		}
	}

	#cancelQueued(job: QueuedJob): void {
		if (job.settled || !this.#queue.includes(job)) return;
		this.#settle(job, cancelledError());
	}

	#settle(job: QueuedJob, error: Error | null, value?: unknown): void {
		if (job.settled) return;
		job.settled = true;
		if (job.abortListener) job.request.signal?.removeEventListener('abort', job.abortListener);
		if (error) job.reject(error);
		else job.resolve(value);
	}

	#isQuarantined(slot: PoolSlot): boolean {
		return slot.selfTest === 'quarantined' || slot.worker.snapshot().quarantined;
	}
}

function cancelledError(): NativeMediaHelperPoolError {
	return new NativeMediaHelperPoolError('cancelled', 'The queued native media job was cancelled.');
}

function disposedError(): NativeMediaHelperPoolError {
	return new NativeMediaHelperPoolError('disposed', 'The native media helper pool is disposed.');
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
