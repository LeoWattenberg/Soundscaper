/* SPDX-License-Identifier: AGPL-3.0-only */
import { aggregateScapeErrors } from '../common/editor/scape-abort.ts';
import { createMotionRenderQueue } from '../common/editor/controller/export/motion-render-pipeline.ts';
import { createMotionscaperRevision } from './editor-project-revision.ts';
import { renderMotionscaperDelivery, type MotionDeliveryOptions } from './editor-render-delivery.ts';
import type { MotionAssetReader } from './editor-render-resources.ts';
import type { MotionDesktopDeliveryReceipt } from './desktop-delivery-contract.ts';

export type MotionDeliveryIntent = Omit<MotionDeliveryOptions, 'store' | 'signal' | 'onProgress' | 'queue' | 'maximumBlobBytes'>;
export type MotionDeliveryOutput = Blob | MotionDesktopDeliveryReceipt | null;
export interface MotionDeliveryJob {
	readonly id: string; readonly title: string; readonly composition: string; readonly revisionDigest: string;
	readonly format: MotionDeliveryIntent['format']; readonly firstFrame: number; readonly endFrame: number;
	readonly status: 'queued' | 'rendering' | 'completed' | 'cancelled' | 'failed'; readonly attempt: number;
	readonly completed: number; readonly total: number; readonly error: string | null; readonly downloadAvailable: boolean; readonly cleanupRequired: boolean;
}
export interface MotionDeliveryJobHandle { readonly id: string; readonly completion: Promise<MotionDeliveryOutput> }
interface QueuedJob {
	view: MotionDeliveryJob; readonly intent: MotionDeliveryIntent; readonly bytes: number;
	readonly controller: AbortController; readonly completion: Promise<MotionDeliveryOutput>;
	resolve(output: MotionDeliveryOutput): void; reject(error: unknown): void; output: MotionDeliveryOutput;
	cancellation: Promise<void> | null; cleanupRequired: boolean;
}
export interface MotionDeliveryQueueOptions {
	readonly store: MotionAssetReader; readonly maximumJobs?: number; readonly maximumOutputBytes?: number;
	readonly maximumJobOutputBytes?: number; readonly maximumIntentBytes?: number;
	readonly deliver?: typeof renderMotionscaperDelivery;
}
const MIB = 1024 * 1024;
function bound(value: number | undefined, fallback: number, maximum: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw new RangeError('Motion render queue admission is invalid.');
	return result;
}
export function createMotionscaperDeliveryQueue(options: MotionDeliveryQueueOptions): MotionscaperDeliveryQueue { return new MotionscaperDeliveryQueue(options); }

/** Runtime-owned jobs retain immutable intent; the store retains original bodies until this queue closes. */
export class MotionscaperDeliveryQueue {
	readonly #options: MotionDeliveryQueueOptions; readonly #renderer = createMotionRenderQueue({ maximumQueuedJobs: 1 });
	readonly #maximumJobs: number; readonly #maximumOutputBytes: number; readonly #maximumJobOutputBytes: number; readonly #maximumIntentBytes: number;
	readonly #jobs = new Map<string, QueuedJob>(); readonly #pending: QueuedJob[] = []; readonly #listeners = new Set<() => void>();
	#snapshot: readonly MotionDeliveryJob[] = Object.freeze([]); #active: QueuedJob | null = null;
	#draining: Promise<void> | null = null; #closing: Promise<void> | null = null; #closed = false; #nextId = 1;
	constructor(options: MotionDeliveryQueueOptions) {
		this.#options = options;
		this.#maximumJobs = bound(options.maximumJobs, 8, 32);
		this.#maximumOutputBytes = bound(options.maximumOutputBytes, 128 * MIB, 256 * MIB);
		this.#maximumJobOutputBytes = bound(options.maximumJobOutputBytes, 64 * MIB, 128 * MIB);
		this.#maximumIntentBytes = bound(options.maximumIntentBytes, 32 * MIB, 64 * MIB);
	}
	snapshot = (): readonly MotionDeliveryJob[] => this.#snapshot;
	subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
	output(id: string): Blob | null { const output = this.#jobs.get(id)?.output; return output instanceof Blob ? output : null; }
	intent(id: string): MotionDeliveryIntent {
		const job = this.#jobs.get(id); if (!job) throw new Error('This render job is unavailable.');
		const { writable: _destination, ...intent } = job.intent; return Object.freeze(intent);
	}
	enqueue(intent: MotionDeliveryIntent): MotionDeliveryJobHandle {
		this.#assertOpen(); if (this.#jobs.size >= this.#maximumJobs) throw new Error('Motion render queue is full; remove a finished job.');
		return this.#admit(intent, `render-${this.#nextId++}`, 1);
	}
	retry(id: string, writable?: WritableStream<Uint8Array>): MotionDeliveryJobHandle {
		this.#assertOpen(); const old = this.#jobs.get(id);
		if (!old || old.cleanupRequired || old.cancellation || !['failed', 'cancelled'].includes(old.view.status)) throw new Error('Only failed or cancelled render jobs can be retried.');
		return this.#admit({ ...this.intent(id), ...(writable ? { writable } : {}) }, id, old.view.attempt + 1);
	}
	#admit(intent: MotionDeliveryIntent, id: string, attempt: number): MotionDeliveryJobHandle {
		const revision = createMotionscaperRevision(intent.project);
		const composition = revision.project.compositions.find(item => item.id === intent.compositionId);
		if (!composition || !Number.isSafeInteger(intent.firstFrame) || !Number.isSafeInteger(intent.endFrame)
			|| intent.firstFrame < 0 || intent.endFrame <= intent.firstFrame || intent.endFrame > composition.durationFrames) throw new Error('Motion render queue requires an available composition and valid frame range.');
		const bytes = new TextEncoder().encode(JSON.stringify(revision.project)).byteLength;
		if (bytes + [...this.#jobs.values()].filter(job => job.view.id !== id).reduce((sum, job) => sum + job.bytes, 0) > this.#maximumIntentBytes) throw new RangeError('Motion render queue intent memory limit reached; remove a finished job.');
		let resolve!: QueuedJob['resolve']; let reject!: QueuedJob['reject'];
		const completion = new Promise<MotionDeliveryOutput>((yes, no) => { resolve = yes; reject = no; }); void completion.catch(() => undefined);
		const job: QueuedJob = { intent: Object.freeze({ ...intent, project: revision.project, ...(intent.background ? { background: Object.freeze([...intent.background]) as MotionDeliveryIntent['background'] } : {}) }),
			bytes, controller: new AbortController(), completion, resolve, reject, output: null, cancellation: null, cleanupRequired: false,
			view: Object.freeze({ id, title: revision.project.title, composition: composition.name, revisionDigest: revision.digest, format: intent.format,
				firstFrame: intent.firstFrame, endFrame: intent.endFrame, attempt, status: 'queued', completed: 0, total: intent.endFrame - intent.firstFrame, error: null, downloadAvailable: false, cleanupRequired: false }) };
		this.#jobs.set(id, job); this.#pending.push(job); this.#emit(); this.#draining ??= Promise.resolve().then(() => this.#drain());
		return Object.freeze({ id, completion });
	}
	async #drain(): Promise<void> {
		try {
			while (this.#pending.length) {
				const job = this.#pending.shift()!; this.#active = job; this.#update(job, { status: 'rendering' });
				let handedToDelivery = false;
				try {
					const retained = [...this.#jobs.values()].reduce((sum, value) => sum + (value.output instanceof Blob ? value.output.size : 0), 0);
					const maximumBlobBytes = Math.min(this.#maximumJobOutputBytes, this.#maximumOutputBytes - retained);
					if (maximumBlobBytes < 1 && !job.intent.writable && job.intent.format !== 'prores') throw new RangeError('Motion render queue output memory limit reached; remove a completed download.');
					handedToDelivery = true;
					const output = await (this.#options.deliver ?? renderMotionscaperDelivery)({ ...job.intent, store: this.#options.store, queue: this.#renderer,
						maximumBlobBytes: Math.max(1, maximumBlobBytes), signal: job.controller.signal, onProgress: (completed, total) => this.#update(job, { completed, total }) });
					if (output instanceof Blob && output.size > maximumBlobBytes) throw new RangeError('Motion render output exceeds its admitted memory limit.');
					// Successful delivery is publication, even if a late cancel arrives during completion.
					job.output = output; this.#update(job, { status: 'completed', downloadAvailable: output instanceof Blob }); job.resolve(output);
				} catch (error) {
					const failures: unknown[] = [];
					try { if (!handedToDelivery) await job.intent.writable?.abort(error); } catch (failure) { failures.push(failure); job.cleanupRequired = true; }
					const failure = aggregateScapeErrors(error, failures, 'Motion render admission and destination cleanup failed.');
					this.#update(job, { status: job.controller.signal.aborted ? 'cancelled' : 'failed', error: failure instanceof Error ? failure.message : String(failure), cleanupRequired: job.cleanupRequired }); job.reject(failure);
				} finally { this.#active = null; }
			}
		} finally { this.#draining = null; }
	}
	cancel(id: string): Promise<void> {
		const job = this.#jobs.get(id); if (!job || (!job.cleanupRequired && !['queued', 'rendering'].includes(job.view.status))) return Promise.resolve();
		if (job.cancellation) return job.cancellation;
		const error = new DOMException('Motion render was cancelled.', 'AbortError'); job.controller.abort(error);
		if (job === this.#active) return job.completion.then(() => undefined, () => undefined);
		const index = this.#pending.indexOf(job); if (index >= 0) this.#pending.splice(index, 1);
		job.cancellation = (async () => {
			try { await job.intent.writable?.abort(error); job.cleanupRequired = false; this.#update(job, { status: 'cancelled', cleanupRequired: false }); job.reject(error); }
			catch (failure) { job.cleanupRequired = true; this.#update(job, { status: 'failed', error: failure instanceof Error ? failure.message : String(failure), cleanupRequired: job.cleanupRequired }); job.reject(failure); throw failure; }
			finally { job.cancellation = null; }
		})(); return job.cancellation;
	}
	remove(id: string): void {
		const job = this.#jobs.get(id); if (!job) return;
		if (job.cleanupRequired || job.cancellation || ['queued', 'rendering'].includes(job.view.status)) throw new Error('Cancel this render job before removing it.');
		this.#jobs.delete(id); job.output = null; this.#emit();
	}
	dispose(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true;
		this.#closing = (async () => {
			const results = await Promise.allSettled([...this.#jobs.keys()].map(id => this.cancel(id)));
			await this.#draining; await this.#renderer.close();
			const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
			if (failures.length) { this.#closing = null; throw new AggregateError(failures.map(result => result.reason), 'Motion render queue cleanup failed.'); }
			this.#jobs.clear(); this.#emit(); this.#listeners.clear();
		})(); return this.#closing;
	}
	#assertOpen(): void { if (this.#closed) throw new Error('Motion render queue is closed.'); }
	#update(job: QueuedJob, update: Partial<MotionDeliveryJob>): void { job.view = Object.freeze({ ...job.view, ...update }); this.#emit(); }
	#emit(): void { this.#snapshot = Object.freeze([...this.#jobs.values()].map(job => job.view)); for (const listener of this.#listeners) { try { listener(); } catch { /* Observer failures cannot revoke output. */ } } }
}
