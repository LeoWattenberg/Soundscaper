/* SPDX-License-Identifier: AGPL-3.0-only */

import { type MotionCompositionFrame, type MotionSceneEvaluator } from '../../motion-composition-evaluation.ts';
import { planMotionTemporalSamples } from '../../motion-temporal-sampling.ts';
import { normalizeMotionTemporalSettings, motionDepthOfFieldSamples, type MotionTemporalSettings } from '../../motion-temporal-settings.ts';
import { renderMotionTemporalSamples } from '../../motion-temporal-rendering.ts';
import { renderMotionCompositionFrame, type MotionCompositor, type MotionRasterizer, type MotionRenderResult } from '../../motion-composition-renderer.ts';
import { motionSurfaceLength } from '../../motion-surface.ts';
import { freezeMotionValue, motionDigest, motionId, motionInteger, motionRational, motionRecord } from '../../motion-values.ts';
import { aggregateScapeErrors, throwIfScapeAborted } from '../../scape-abort.ts';
import { divideRationals, type Rational } from '../../timeline-time.ts';
import type { MotionAudioMixBlock, MotionAudioMixer } from '../../motion-audio-contract.ts';
import type { MotionExpressionAudioPreparation } from '../../motion-expression-audio-preparation.ts';
import { createMotionRenderAudio } from './internal/motion-render-audio.ts';

export interface MotionRenderIdentity {
	readonly projectId: string; readonly revisionDigest: string; readonly compositionId: string;
}
export interface MotionRenderPlan {
	readonly identity: MotionRenderIdentity; readonly width: number; readonly height: number;
	readonly frameRate: Rational; readonly firstFrame: number; readonly frameCount: number;
	readonly temporal?: MotionTemporalSettings; readonly depthOfFieldSamples?: number;
}
export interface MotionRenderFrame {
	readonly index: number; readonly time: Rational; readonly duration: Rational; readonly surface: MotionRenderResult;
}
export interface MotionRenderLease {
	readonly evaluator: MotionSceneEvaluator; readonly rasterizer: MotionRasterizer; readonly compositor?: MotionCompositor;
	readonly maximumWorkingBytes?: number;
	readonly audioMixer?: MotionAudioMixer;
	readonly expressionAudio?: MotionExpressionAudioPreparation;
	release(): Promise<void>;
}
export interface MotionRenderAudioSink {
	readonly sampleRate: number; readonly channels: 1 | 2;
	write(block: MotionAudioMixBlock, signal?: AbortSignal): Promise<void>;
}
export interface MotionRenderSink<Result> {
	/** Image-only delivery may explicitly omit audio; video must consume it or refuse it. */
	readonly audioPolicy?: 'exclude';
	readonly audio?: MotionRenderAudioSink;
	/** Resolves only after consuming this frame; the producer will then release its reference. */
	write(frame: MotionRenderFrame, signal?: AbortSignal): Promise<void>;
	/** Atomically publish completed output; honour cancellation before committing it. */
	finish(signal?: AbortSignal): Promise<Result>;
	abort(reason: unknown): Promise<void>;
}
export interface MotionRenderRequest<Result> {
	readonly plan: MotionRenderPlan; readonly signal?: AbortSignal;
	readonly acquire: (signal?: AbortSignal) => Promise<MotionRenderLease>;
	readonly sink: MotionRenderSink<Result>;
	readonly onProgress?: (completed: number, total: number) => void;
}
export interface MotionRenderReceipt<Result> {
	readonly identity: MotionRenderIdentity; readonly renderedFrames: number; readonly output: Result;
}

export function normalizeMotionRenderPlan(value: unknown): MotionRenderPlan {
	const fields = ['identity', 'width', 'height', 'frameRate', 'firstFrame', 'frameCount'];
	const record = motionRecord(value, [...fields, 'temporal', 'depthOfFieldSamples'], 'motion render plan', fields);
	const identity = motionRecord(record.identity, ['projectId', 'revisionDigest', 'compositionId'], 'motion render identity');
	const width = motionInteger(record.width, 'render width', 1);
	const height = motionInteger(record.height, 'render height', 1);
	motionSurfaceLength(width, height);
	const firstFrame = motionInteger(record.firstFrame, 'first render frame');
	const frameCount = motionInteger(record.frameCount, 'render frame count', 1, 100_000_000);
	if (!Number.isSafeInteger(firstFrame + frameCount)) throw new RangeError('Motion render range exceeds exact frame coordinates.');
	return freezeMotionValue({ identity: { projectId: motionId(identity.projectId), revisionDigest: motionDigest(identity.revisionDigest), compositionId: motionId(identity.compositionId) },
		width, height, frameRate: motionRational(record.frameRate, 'render frame rate', true), firstFrame, frameCount,
		...(Object.hasOwn(record, 'temporal') ? { temporal: normalizeMotionTemporalSettings(record.temporal) } : {}),
		...(Object.hasOwn(record, 'depthOfFieldSamples') ? { depthOfFieldSamples: motionDepthOfFieldSamples(record.depthOfFieldSamples) } : {}) });
}

/** One rendered frame at a time, with sink backpressure; duration never determines resident memory. */
export async function renderMotionFrameSequence<Result>(request: MotionRenderRequest<Result>): Promise<MotionRenderReceipt<Result>> {
	let lease: MotionRenderLease | null = null;
	let released = false;
	try {
		const plan = normalizeMotionRenderPlan(request.plan);
		throwIfScapeAborted(request.signal);
		lease = await request.acquire(request.signal);
		throwIfScapeAborted(request.signal);
		const audio = createMotionRenderAudio(plan, lease, request.sink);
		if (lease.expressionAudio && lease.expressionAudio.revision.digest !== plan.identity.revisionDigest) throw new Error('Prepared expression audio belongs to a stale render revision.');
		const duration = Object.freeze(divideRationals({ num: 1, den: 1 }, plan.frameRate));
		for (let index = 0; index < plan.frameCount; index += 1) {
			throwIfScapeAborted(request.signal);
			const time = Object.freeze(divideRationals({ num: plan.firstFrame + index, den: 1 }, plan.frameRate));
			const retainedLease = lease; const sampling = planMotionTemporalSamples({ ...plan, id: plan.identity.compositionId }, time);
			const surface = await renderMotionTemporalSamples({ evaluator: lease.evaluator, plan: sampling, expressionAudio: lease.expressionAudio, signal: request.signal, maximumWorkingBytes: lease.maximumWorkingBytes,
				render: (frame, quality) => {
					if (!audio && request.sink.audioPolicy !== 'exclude' && motionFrameHasAudio(frame)) throw new Error('This video renderer cannot deliver composition audio. Choose an image sequence or an audio-capable video encoder.');
					return renderMotionCompositionFrame(frame, { rasterizer: retainedLease.rasterizer, compositor: retainedLease.compositor, signal: request.signal, ...quality });
				} });
			await audio?.writeThroughFrame(index + 1, request.signal);
			await request.sink.write(Object.freeze({ index, time, duration, surface }), request.signal);
			throwIfScapeAborted(request.signal);
			try { request.onProgress?.(index + 1, plan.frameCount); } catch { /* Presentation observers cannot revoke a render. */ }
			// A synchronous rasterizer/PNG sink must still let cancellation and presentation tasks run.
			await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
		}
		released = true;
		await lease.release();
		throwIfScapeAborted(request.signal);
		const output = await request.sink.finish(request.signal);
		// A successful atomic finish is publication, even if cancellation arrives immediately afterwards.
		return Object.freeze({ identity: plan.identity, renderedFrames: plan.frameCount, output });
	} catch (error) {
		const cleanup: unknown[] = [];
		if (lease && !released) {
			try { await lease.release(); } catch (failure) { cleanup.push(failure); }
		}
		try { await request.sink.abort(error); } catch (failure) { cleanup.push(failure); }
		throw aggregateScapeErrors(error, cleanup, 'Motion render and cleanup failed.');
	}
}

function motionFrameHasAudio(frame: MotionCompositionFrame): boolean {
	return frame.audio.length > 0 || frame.layers.some((layer) => layer.precomposition !== null && motionFrameHasAudio(layer.precomposition));
}

export interface MotionRenderHandle<Result> {
	readonly completion: Promise<MotionRenderReceipt<Result>>;
	cancel(): void;
}
interface PendingRender { readonly controller: AbortController; run(): Promise<void> }

export function createMotionRenderQueue(options: Readonly<{ maximumQueuedJobs?: number }> = {}): MotionRenderQueue {
	return new MotionRenderQueue(options.maximumQueuedJobs ?? 4);
}

/** Exactly one active generation; pending descriptors are capped independently of output duration. */
export class MotionRenderQueue {
	readonly #maximumQueuedJobs: number;
	readonly #pending: PendingRender[] = [];
	#active: PendingRender | null = null;
	#draining: Promise<void> | null = null;
	#closed = false;
	constructor(maximumQueuedJobs: number) { this.#maximumQueuedJobs = motionInteger(maximumQueuedJobs, 'queued render jobs', 1, 32); }

	enqueue<Result>(request: MotionRenderRequest<Result>): MotionRenderHandle<Result> {
		if (this.#closed) throw new Error('Motion render queue is closed.');
		if (this.#pending.length >= this.#maximumQueuedJobs) throw new Error('Motion render queue is full; finish or cancel an existing job.');
		const plan = normalizeMotionRenderPlan(request.plan);
		const controller = new AbortController();
		const cancelFromParent = (): void => { controller.abort(request.signal?.reason); };
		if (request.signal?.aborted) cancelFromParent();
		else request.signal?.addEventListener('abort', cancelFromParent, { once: true });
		const completion = new Promise<MotionRenderReceipt<Result>>((resolve, reject) => {
			this.#pending.push({ controller, run: async () => {
				try { resolve(await renderMotionFrameSequence({ ...request, plan, signal: controller.signal })); }
				catch (error) { reject(error); }
				finally { request.signal?.removeEventListener('abort', cancelFromParent); }
			} });
		});
		// Closing owns cleanup even when a caller discarded its completion handle.
		void completion.catch(() => undefined);
		this.#draining ??= this.#drain();
		return Object.freeze({ completion, cancel() { controller.abort(new DOMException('Cancelled motion render', 'AbortError')); } });
	}

	async #drain(): Promise<void> {
		try {
			while (this.#pending.length > 0) {
				this.#active = this.#pending.shift()!;
				await this.#active.run();
				this.#active = null;
			}
		} finally { this.#draining = null; }
	}

	close(): Promise<void> {
		this.#closed = true;
		const reason = new DOMException('Motion render queue closed', 'AbortError');
		this.#active?.controller.abort(reason);
		for (const job of this.#pending) job.controller.abort(reason);
		return this.#draining ?? Promise.resolve();
	}
}
