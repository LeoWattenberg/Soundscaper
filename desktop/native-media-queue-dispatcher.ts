/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned durable queue dispatcher for the authenticated native-media pool. */

import {
	assertNativeQueueRecordV2,
	type NativeQueueRecordV2,
} from '../src/common/editor/native-queue-record.ts';
import {
	nativeQueueCapacitySnapshotV1,
	type NativeQueueCapacityV1,
} from '../src/common/editor/native-queue-admission.ts';
import { createNativeMediaPlanEnvelopeV1 } from '../src/common/editor/native-media-plan-envelope.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { assertUnifiedExactRenderPlanWithDeferredTimingReferences } from '../src/common/editor/unified-exact-render-plan.ts';
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
	readonly capacity: () => NativeQueueCapacityV1 | null | Promise<NativeQueueCapacityV1 | null>;
	readonly pool: Readonly<{ runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown> }>;
	readonly prepare: (
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant,
	) => Promise<PreparedNativeMediaQueueJob>;
	readonly onError?: (error: unknown, record: NativeQueueRecordV2) => void;
}

export class FramescaperNativeMediaQueueDispatcher {
	readonly #options: FramescaperNativeMediaQueueDispatcherOptions;
	readonly #active = new Map<string, Promise<void>>();
	readonly #activeAbort = new Map<string, AbortController>();
	#loop: Promise<void> | null = null;
	#wakeRequested = false;
	#wake: (() => void) | null = null;
	#disposed = false;
	#disposal: Promise<boolean> | null = null;

	constructor(options: FramescaperNativeMediaQueueDispatcherOptions) {
		if (typeof options.capacity !== 'function') {
			throw new TypeError('A native media queue dispatcher requires a capacity snapshot provider.');
		}
		this.#options = options;
	}

	dispatch(records: readonly NativeQueueRecordV2[]): Promise<void> {
		if (this.#disposed) return Promise.reject(new Error('The native media queue dispatcher is disposed.'));
		for (const record of records) assertNativeQueueRecordV2(record);
		if (!records.some((record) => record.state === 'queued')) return Promise.resolve();
		if (this.#loop === null) {
			this.#loop = this.#drain().finally(() => { this.#loop = null; });
		}
		else {
			this.#wakeRequested = true;
			this.#wake?.();
		}
		return this.#loop;
	}

	dispose(): Promise<boolean> {
		if (this.#disposal !== null) return this.#disposal;
		this.#disposed = true;
		this.#wake?.();
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
		else void this.dispatch([record]).catch((error: unknown) => this.#options.onError?.(error, record));
	}

	async #drain(): Promise<void> {
		for (;;) {
			if (!this.#options.available() || !this.#options.nativeMediaEnabled()) return;
			const observed = await this.#options.capacity();
			if (observed === null || this.#disposed) return;
			const capacity = nativeQueueCapacitySnapshotV1(observed);
			if (!this.#options.available() || !this.#options.nativeMediaEnabled()) return;
			const admitted = this.#options.queue.dispatchReady(
				this.#options.lease(), this.#options.now(), capacity,
			).records;
			for (const record of admitted) {
				if (this.#active.has(record.jobId)) {
					throw new Error('Writer-atomic queue admission returned an already active job.');
				}
				const operation = this.#execute(record).finally(() => {
					this.#active.delete(record.jobId);
				});
				this.#active.set(record.jobId, operation);
			}
			if (this.#active.size === 0) {
				if (this.#wakeRequested) {
					this.#wakeRequested = false;
					continue;
				}
				return;
			}
			if (this.#wakeRequested) this.#wakeRequested = false;
			else await this.#waitForCompletionOrWake();
			if (this.#disposed) return;
		}
	}

	async #waitForCompletionOrWake(): Promise<void> {
		const wake = new Promise<void>((resolve) => {
			this.#wake = resolve;
			if (this.#wakeRequested) resolve();
		});
		try { await Promise.race([...this.#active.values(), wake]); }
		finally {
			this.#wake = null;
			this.#wakeRequested = false;
		}
	}

	async #execute(record: NativeQueueRecordV2): Promise<void> {
		let preparationPhase: 'plan' | 'root' | 'prepare' | 'execute' = 'plan';
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
			preparationPhase = 'execute';
			const currentPrepared = prepared;
			const relayAbort = (): void => abort.abort(currentPrepared.request.signal?.reason);
			if (currentPrepared.request.signal?.aborted) relayAbort();
			else currentPrepared.request.signal?.addEventListener('abort', relayAbort, { once: true });
			abort.signal.throwIfAborted();
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
			else if (current?.state === 'running') {
				if (preparationPhase === 'execute') {
					this.#options.queue.control(
						record.jobId, { kind: 'fail', code: 'native-helper-failed' },
						this.#options.lease(), this.#options.now(),
					);
				}
				else this.#recordPreparationFailure(record, preparationPhase);
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
	const fingerprint = fingerprintNativeMediaPlan(plan);
	if ((plan as Readonly<Record<string, unknown>>).version !== record.planVersion
		|| fingerprint.sha256 !== record.planFingerprint || fingerprint.canonical !== record.planPayload) {
		throw new Error('A queued native media plan no longer matches its exact durable fingerprint.');
	}
	try {
		createNativeMediaPlanEnvelopeV1(plan);
	} catch (error) {
		if (record.planVersion < 9) throw error;
		assertUnifiedExactRenderPlanWithDeferredTimingReferences(plan);
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
