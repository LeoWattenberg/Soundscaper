/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned durable queue dispatcher for the authenticated native-media pool. */

import {
	assertNativeQueueRecordV2,
	type NativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import type { FramescaperNativeServicesLease } from './native-services-database.ts';
import type {
	NativeMediaHelperPoolJobKind,
	NativeMediaHelperPoolJobRequest,
} from './native-media-helper-pool.ts';
import type { FramescaperNativeQueueRepository } from './native-services-queue-repository.ts';
import type {
	FramescaperNativeRootGrant,
	FramescaperNativeRootRepository,
} from './native-services-root-repository.ts';

export interface PreparedNativeMediaQueueJob {
	readonly request: NativeMediaHelperPoolJobRequest;
	publish(result: unknown): Promise<void>;
	cleanup?(outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed'): Promise<void>;
}

export interface FramescaperNativeMediaQueueDispatcherOptions {
	readonly queue: FramescaperNativeQueueRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly lease: () => FramescaperNativeServicesLease;
	readonly now: () => number;
	readonly available: () => boolean;
	readonly nativeMediaEnabled: () => boolean;
	readonly pool: Readonly<{ runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown> }>;
	readonly prepare: (
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant,
	) => Promise<PreparedNativeMediaQueueJob>;
	readonly concurrency?: number;
	readonly onError?: (error: unknown, record: NativeQueueRecordV2) => void;
}

export class FramescaperNativeMediaQueueDispatcher {
	readonly #options: FramescaperNativeMediaQueueDispatcherOptions;
	readonly #concurrency: number;
	readonly #pending = new Set<string>();
	readonly #active = new Map<string, Promise<void>>();
	readonly #activeAbort = new Map<string, AbortController>();
	#loop: Promise<void> | null = null;
	#disposed = false;
	#disposal: Promise<boolean> | null = null;

	constructor(options: FramescaperNativeMediaQueueDispatcherOptions) {
		const concurrency = options.concurrency ?? 2;
		if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) {
			throw new RangeError('A native media queue dispatcher requires one through four workers.');
		}
		this.#options = options;
		this.#concurrency = concurrency;
	}

	dispatch(records: readonly NativeQueueRecordV2[]): Promise<void> {
		if (this.#disposed) return Promise.reject(new Error('The native media queue dispatcher is disposed.'));
		for (const record of records) {
			assertNativeQueueRecordV2(record);
			if (record.state === 'queued' && !this.#active.has(record.jobId)) this.#pending.add(record.jobId);
		}
		this.#loop ??= this.#drain().finally(() => {
			this.#loop = null;
			if (this.#pending.size > 0 && !this.#disposed) void this.dispatch([]).catch(() => undefined);
		});
		return this.#loop;
	}

	dispose(): Promise<boolean> {
		if (this.#disposal !== null) return this.#disposal;
		this.#disposed = true;
		this.#pending.clear();
		for (const abort of this.#activeAbort.values()) abort.abort();
		this.#disposal = (async () => {
			const operations = [...this.#active.values()];
			if (this.#loop !== null) operations.push(this.#loop);
			await Promise.allSettled(operations);
			return true;
		})();
		return this.#disposal;
	}

	control(record: NativeQueueRecordV2, action: 'pause' | 'resume' | 'cancel' | 'retry'): void {
		if (action === 'pause' || action === 'cancel') this.#activeAbort.get(record.jobId)?.abort();
		else void this.dispatch([record]).catch(() => undefined);
	}

	async #drain(): Promise<void> {
		if (!this.#options.available() || !this.#options.nativeMediaEnabled()) {
			this.#pending.clear();
			return;
		}
		for (;;) {
			while (this.#active.size < this.#concurrency) {
				const jobId = this.#nextPendingJobId();
				if (jobId === undefined) break;
				this.#pending.delete(jobId);
				const record = this.#options.queue.read(jobId);
				if (record === null || record.state !== 'queued') continue;
				const operation = this.#execute(record).finally(() => { this.#active.delete(jobId); });
				this.#active.set(jobId, operation);
			}
			if (this.#active.size === 0) return;
			await Promise.race(this.#active.values());
			if (this.#disposed) return;
		}
	}

	async #execute(record: NativeQueueRecordV2): Promise<void> {
		let running = false;
		let preparationPhase: 'plan' | 'root' | 'prepare' = 'plan';
		let prepared: PreparedNativeMediaQueueJob | null = null;
		let outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed' = 'failed';
		const abort = new AbortController();
		this.#activeAbort.set(record.jobId, abort);
		try {
			assertQueuePlan(record);
			preparationPhase = 'root';
			const root = this.#options.roots.requireActive(record.rootGrantId);
			preparationPhase = 'prepare';
			prepared = await this.#options.prepare(record, root);
			assertPreparedJob(record, prepared);
			const currentPrepared = prepared;
			const relayAbort = (): void => abort.abort(currentPrepared.request.signal?.reason);
			if (currentPrepared.request.signal?.aborted) relayAbort();
			else currentPrepared.request.signal?.addEventListener('abort', relayAbort, { once: true });
			abort.signal.throwIfAborted();
			this.#options.queue.control(record.jobId, { kind: 'dispatch' }, this.#options.lease(), this.#options.now());
			running = true;
			let result: unknown;
			try {
				result = await this.#options.pool.runJob({
					...currentPrepared.request, signal: abort.signal,
					onProgress: (value) => {
						currentPrepared.request.onProgress?.(value);
						if (value !== null) this.#reportProgress(record.jobId, value);
					},
				});
			} finally {
				currentPrepared.request.signal?.removeEventListener('abort', relayAbort);
			}
			await currentPrepared.publish(result);
			this.#options.queue.control(record.jobId, { kind: 'complete' }, this.#options.lease(), this.#options.now());
			outcome = 'succeeded';
		} catch (error) {
			const current = this.#options.queue.read(record.jobId);
			if (current?.state === 'paused') {
				outcome = 'paused';
			}
			else if (abort.signal.aborted || current?.state === 'cancelled') {
				outcome = 'cancelled';
				if (current?.state === 'running') {
					this.#options.queue.control(
						record.jobId, { kind: 'cancel' }, this.#options.lease(), this.#options.now(),
					);
				}
			}
			else if (running && current?.state === 'running') {
				this.#options.queue.control(
					record.jobId, { kind: 'fail', code: 'native-helper-failed' },
					this.#options.lease(), this.#options.now(),
				);
			}
			else if (!running && current?.state === 'queued') {
				this.#recordPreparationFailure(record, preparationPhase);
			}
			this.#options.onError?.(error, record);
		} finally {
			this.#activeAbort.delete(record.jobId);
			if (prepared?.cleanup) {
				try { await prepared.cleanup(outcome); }
				catch (error) { this.#options.onError?.(error, record); }
			}
		}
	}

	#nextPendingJobId(): string | undefined {
		for (const record of this.#options.queue.list()) {
			if (record.state === 'queued' && this.#pending.has(record.jobId)) return record.jobId;
		}
		return undefined;
	}

	#recordPreparationFailure(
		record: NativeQueueRecordV2,
		phase: 'plan' | 'root' | 'prepare',
	): void {
		if (phase === 'plan') {
			this.#options.queue.control(
				record.jobId, { kind: 'block', code: 'plan-fingerprint-changed' },
				this.#options.lease(), this.#options.now(),
			);
			return;
		}
		if (phase === 'root') {
			this.#options.queue.control(
				record.jobId, { kind: 'require-authorization' },
				this.#options.lease(), this.#options.now(),
			);
			return;
		}
		this.#options.queue.control(
			record.jobId, { kind: 'fail', code: 'native-prepare-failed' },
			this.#options.lease(), this.#options.now(),
		);
	}

	#reportProgress(jobId: string, value: number): void {
		if (this.#options.queue.read(jobId)?.state !== 'running') return;
		this.#options.queue.control(
			jobId, { kind: 'report-progress', value }, this.#options.lease(), this.#options.now(),
		);
	}
}

function assertQueuePlan(record: NativeQueueRecordV2): void {
	let plan: unknown;
	try { plan = JSON.parse(record.planPayload) as unknown; }
	catch { throw new Error('A queued native media plan is not JSON.'); }
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	if (envelope.planVersion !== record.planVersion || envelope.fingerprint !== record.planFingerprint) {
		throw new Error('A queued native media plan no longer matches its exact durable fingerprint.');
	}
}

function assertPreparedJob(record: NativeQueueRecordV2, prepared: PreparedNativeMediaQueueJob): void {
	const expected: NativeMediaHelperPoolJobKind = record.taskKind === 'proxy-generation'
		? 'media-proxy' : 'media-render';
	if (!prepared || typeof prepared !== 'object' || typeof prepared.publish !== 'function'
		|| !prepared.request || prepared.request.kind !== expected) {
		throw new Error('A queued native media task was not prepared as its exact helper operation.');
	}
	const grant = prepared.request.grant as unknown as Readonly<{
		plan?: Readonly<{ sha256?: unknown }>;
	}>;
	if (grant.plan?.sha256 !== record.planFingerprint) {
		throw new Error('A queued native media helper request does not carry its exact plan fingerprint.');
	}
}
