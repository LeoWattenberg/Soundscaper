/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned durable queue dispatcher for the authenticated native-media pool. */

import {
	assertNativeQueueRecordV3,
	type NativeQueueRecordV3,
} from '../src/common/editor/native-queue-record-v3.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import {
	nativeQueueCapacitySnapshotV1,
	type NativeQueueCapacityV1,
} from '../src/common/editor/native-queue-admission.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import type { FramescaperNativeServicesLease } from './native-services-database.ts';
import type {
	NativeMediaHelperPoolJobKind,
	NativeMediaHelperPoolJobRequest,
} from './native-media-helper-pool.ts';
import type { FramescaperNativeQueueRepository } from './native-services-queue-repository-v3.ts';
import type {
	FramescaperNativeRootGrant,
	FramescaperNativeRootRepository,
} from './native-services-root-repository.ts';
import { nativeQueueRecordRequiresRendererCarrier } from './native-services-carrier-recovery-v3.ts';

export interface PreparedNativeMediaQueueJobV3 {
	readonly request?: NativeMediaHelperPoolJobRequest;
	readonly execute?: (context: Readonly<{
		readonly signal: AbortSignal;
		readonly onProgress: (value: number | null) => void;
	}>) => Promise<unknown>;
	publish(result: unknown): Promise<void>;
	cleanup?(outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed'): Promise<void>;
}

export interface FramescaperNativeMediaQueueDispatcherV3Options {
	readonly queue: FramescaperNativeQueueRepository;
	readonly roots: FramescaperNativeRootRepository;
	readonly lease: () => FramescaperNativeServicesLease;
	readonly now: () => number;
	readonly available: () => boolean;
	readonly nativeMediaEnabled: () => boolean;
	readonly capacity: () => NativeQueueCapacityV1 | null | Promise<NativeQueueCapacityV1 | null>;
	readonly pool?: Readonly<{ runJob(request: NativeMediaHelperPoolJobRequest): Promise<unknown> }>;
	readonly prepare: (
		record: NativeQueueRecordV3,
		root: FramescaperNativeRootGrant,
	) => Promise<PreparedNativeMediaQueueJobV3>;
	readonly removeInactiveCarrier?: (record: NativeQueueRecordV3) => Promise<void>;
	readonly onError?: (error: unknown, record: NativeQueueRecordV3) => void;
}

export class FramescaperNativeMediaQueueDispatcherV3 {
	readonly #options: FramescaperNativeMediaQueueDispatcherV3Options;
	readonly #active = new Map<string, Promise<void>>();
	readonly #activeAbort = new Map<string, AbortController>();
	#loop: Promise<void> | null = null;
	#wakeRequested = false;
	#wake: (() => void) | null = null;
	#disposed = false;
	#shutdown = false;
	#disposal: Promise<boolean> | null = null;

	constructor(options: FramescaperNativeMediaQueueDispatcherV3Options) {
		if (typeof options.capacity !== 'function') {
			throw new TypeError('A native media queue dispatcher requires a capacity snapshot provider.');
		}
		this.#options = options;
	}

	dispatch(records: readonly NativeQueueRecordV3[]): Promise<void> {
		if (this.#disposed) return Promise.reject(new Error('The native media queue dispatcher is disposed.'));
		for (const record of records) assertNativeQueueRecordV3(record);
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

	dispose(reason: 'cancel' | 'shutdown' = 'cancel'): Promise<boolean> {
		if (this.#disposal !== null) return this.#disposal;
		if (reason !== 'cancel' && reason !== 'shutdown') {
			return Promise.reject(new RangeError('Native media dispatcher disposal reason is unsupported.'));
		}
		this.#disposed = true;
		this.#shutdown = reason === 'shutdown';
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

	async control(record: NativeQueueRecordV3, action: 'pause' | 'resume' | 'cancel' | 'retry'): Promise<void> {
		if (action === 'pause' || action === 'cancel') {
			const active = this.#activeAbort.get(record.jobId);
			if (active) { active.abort(); return; }
			if (recordRequiresCarrier(record)) {
				if (!this.#options.removeInactiveCarrier) {
					throw new Error('An inactive live carrier cannot be settled without main-owned custody.');
				}
				await this.#options.removeInactiveCarrier(record);
			}
			return;
		}
		void this.dispatch([record]).catch((error: unknown) => this.#options.onError?.(error, record));
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

	async #execute(record: NativeQueueRecordV3): Promise<void> {
		let preparationPhase: 'plan' | 'root' | 'prepare' | 'execute' = 'plan';
		let prepared: PreparedNativeMediaQueueJobV3 | null = null;
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
			const request = currentPrepared.request;
			const relayAbort = (): void => abort.abort(request?.signal?.reason);
			if (request?.signal?.aborted) relayAbort();
			else request?.signal?.addEventListener('abort', relayAbort, { once: true });
			abort.signal.throwIfAborted();
			let result: unknown;
			try {
				const onProgress = (value: number | null): void => {
					request?.onProgress?.(value);
					if (value !== null) this.#reportProgress(record.jobId, value);
				};
				result = currentPrepared.execute
					? await currentPrepared.execute({ signal: abort.signal, onProgress })
					: await this.#options.pool!.runJob({ ...request!, signal: abort.signal, onProgress });
			} finally {
				request?.signal?.removeEventListener('abort', relayAbort);
			}
			await currentPrepared.publish(result);
			this.#options.queue.control(record.jobId, { kind: 'complete' }, this.#options.lease(), this.#options.now());
			outcome = 'succeeded';
		} catch (error) {
			const current = this.#options.queue.read(record.jobId);
			if (current?.state === 'paused') {
				outcome = 'paused';
			}
			else if (current?.state === 'cancelled') {
				outcome = 'cancelled';
			}
			else if (abort.signal.aborted && this.#shutdown) {
				// A graceful process boundary is not authored cancellation. Pause the durable
				// row so restart cannot dispatch before any live carrier is regenerated.
				outcome = 'paused';
				if (current?.state === 'running' && recordRequiresCarrier(record)) {
					this.#options.queue.control(
						record.jobId, { kind: 'await-carrier-regeneration' },
						this.#options.lease(), this.#options.now(),
					);
				}
			}
			else if (abort.signal.aborted) {
				outcome = 'cancelled';
				if (current?.state === 'running') {
					this.#options.queue.control(
						record.jobId, { kind: 'cancel' }, this.#options.lease(), this.#options.now(),
					);
				}
			}
			else if (current?.state === 'running') {
				if (preparationPhase === 'execute') {
					const code = executionFailureCode(error);
					this.#options.queue.control(record.jobId,
						code !== 'web-core-required' && recordRequiresCarrier(record)
							? { kind: 'await-carrier-regeneration' }
							: { kind: 'fail', code },
						this.#options.lease(), this.#options.now());
				}
				else this.#recordPreparationFailure(record, preparationPhase);
			}
			this.#options.onError?.(error, record);
		} finally {
			this.#activeAbort.delete(record.jobId);
			let settled = false;
			if (prepared?.cleanup) {
				try { await prepared.cleanup(outcome); settled = true; }
				catch (error) { this.#options.onError?.(error, record); }
			}
			const durable = this.#options.queue.read(record.jobId);
			if (!settled && outcome !== 'succeeded' && durable?.state !== 'needs-authorization'
				&& recordRequiresCarrier(record)
				&& this.#options.removeInactiveCarrier) {
				try { await this.#options.removeInactiveCarrier(record); }
				catch (error) { this.#options.onError?.(error, record); }
			}
		}
	}

	#recordPreparationFailure(
		record: NativeQueueRecordV3,
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
		if (recordRequiresCarrier(record)) {
			this.#options.queue.control(
				record.jobId, { kind: 'await-carrier-regeneration' },
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

function executionFailureCode(error: unknown): string {
	const code = error && typeof error === 'object'
		? (error as Readonly<{ readonly code?: unknown }>).code : undefined;
	return code === 'web-core-required' ? code : 'native-helper-failed';
}

function assertQueuePlan(record: NativeQueueRecordV3): void {
	let plan: unknown;
	try { plan = JSON.parse(record.planPayload) as unknown; }
	catch { throw new Error('A queued native media plan is not JSON.'); }
	const fingerprint = fingerprintNativeMediaPlan(plan);
	if (record.planVersion !== 14
		|| (plan as Readonly<Record<string, unknown>>).version !== record.planVersion
		|| fingerprint.sha256 !== record.planFingerprint || fingerprint.canonical !== record.planPayload) {
		throw new Error('A queued native media plan no longer matches its exact durable fingerprint.');
	}
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	if (envelope.planVersion !== 14 || envelope.fingerprint !== record.planFingerprint) {
		throw new Error('Selected native queue V3 dispatch requires exact envelope V2 plan V14.');
	}
}

function recordRequiresCarrier(record: NativeQueueRecordV3): boolean {
	return nativeQueueRecordRequiresRendererCarrier(record);
}

function assertPreparedJob(record: NativeQueueRecordV3, prepared: PreparedNativeMediaQueueJobV3): void {
	const expected: NativeMediaHelperPoolJobKind = record.taskKind === 'proxy-generation'
		? 'media-proxy' : 'media-render';
	if (!prepared || typeof prepared !== 'object' || typeof prepared.publish !== 'function'
		|| ((prepared.request === undefined) === (prepared.execute === undefined))
		|| (prepared.request !== undefined && prepared.request.kind !== expected)
		|| (prepared.execute !== undefined && typeof prepared.execute !== 'function')) {
		throw new Error('A queued native media task was not prepared as its exact helper operation.');
	}
	if (prepared.execute !== undefined) return;
	const grant = prepared.request!.grant as unknown as Readonly<{
		plan?: Readonly<{ sha256?: unknown }>;
	}>;
	if (grant.plan?.sha256 !== record.planFingerprint) {
		throw new Error('A queued native media helper request does not carry its exact plan fingerprint.');
	}
}
