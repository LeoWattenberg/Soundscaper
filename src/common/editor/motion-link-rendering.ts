/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeMotionCompositionOffer, type MotionCompositionOffer } from './motion-link-protocol.ts';
import { createMotionSceneEvaluator, type MotionSceneEvaluator } from './motion-composition-evaluation.ts';
import { renderMotionCompositionFrame, type MotionCompositor, type MotionRasterizer, type MotionRenderResult } from './motion-composition-renderer.ts';
import { requireMotionTrackingReady } from './motion-tracking-admission.ts';
import { admitMotionTemporalWork, planMotionTemporalSamples, type MotionPreviewQuality } from './motion-temporal-sampling.ts';
import { renderMotionTemporalSamples } from './motion-temporal-rendering.ts';
import type { MotionExpressionAudioPreparation } from './motion-expression-audio-preparation.ts';
import { motionSurfaceLength } from './motion-surface.ts';
import { assertMotionWorkingBudget, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';
import { aggregateScapeErrors } from './scape-abort.ts';
import { compareRationals, divideRationals, normalizeRational, type Rational, type RationalInput } from './timeline-time.ts';

export interface MotionCompositionLinkRenderPlan { readonly offer: MotionCompositionOffer }
export interface MotionCompositionLinkRasterLease {
	readonly rasterizer: MotionRasterizer; readonly compositor?: MotionCompositor; readonly expressionAudio?: MotionExpressionAudioPreparation;
	release(): Promise<void>;
}
type Purpose = Readonly<{ purpose: 'final'; quality?: never }> | Readonly<{ purpose: 'preview'; quality?: MotionPreviewQuality }>;
type RenderOptions = Purpose & Readonly<{
	signal?: AbortSignal; maximumWorkingBytes?: number;
	/** Retain this exact receiver-owned closure until release; a partial acquisition must clean up before rejecting. */
	acquire: (offer: MotionCompositionOffer, signal?: AbortSignal) => Promise<MotionCompositionLinkRasterLease>;
}>;
export interface MotionCompositionLinkFrame {
	readonly identity: Readonly<{ projectId: string; compositionId: string; revisionDigest: string }>;
	readonly time: Rational; readonly surface: MotionRenderResult;
}
const evaluators = new WeakMap<MotionCompositionLinkRenderPlan, MotionSceneEvaluator>();

/** No transport or mutable edit session participates in an already pinned source/render task. */
export function compileMotionCompositionLink(value: unknown): MotionCompositionLinkRenderPlan {
	const offer = normalizeMotionCompositionOffer(value); requireMotionTrackingReady(offer.revision.project);
	const evaluator = createMotionSceneEvaluator(offer.revision.project, { revisionDigest: offer.revision.digest });
	const plan = Object.freeze({ offer }); evaluators.set(plan, evaluator); return plan;
}

/** Source time is exact composition seconds, after the owning timeline has applied trim/retime. Return the linear premultiplied working surface. */
export async function renderMotionCompositionLink(plan: MotionCompositionLinkRenderPlan, sourceTime: RationalInput, options: RenderOptions): Promise<MotionCompositionLinkFrame> {
	const evaluator = evaluators.get(plan); if (!evaluator) throw new TypeError('A compiled motion composition link is required.');
	options.signal?.throwIfAborted();
	if (!['preview', 'final'].includes(options.purpose)) throw new RangeError('Motion linked render purpose is unsupported.');
	if (options.purpose === 'final' && options.quality !== undefined) throw new RangeError('Motion linked final render must use authored quality.');
	const offer = plan.offer; const project = offer.revision.project; const composition = project.compositions.find((entry) => entry.id === offer.compositionId)!;
	const time = normalizeRational(sourceTime, { maximumDenominator: Number.MAX_SAFE_INTEGER });
	const end = divideRationals({ num: composition.durationFrames, den: 1 }, composition.frameRate);
	if (compareRationals(time, 0) < 0 || compareRationals(time, end) >= 0) throw new RangeError('Motion linked source time is outside its accepted half-open duration.');
	admitMotionTemporalWork(project, composition.id, options.quality);
	const sampling = planMotionTemporalSamples(composition, time, options.quality);
	const maximum = options.maximumWorkingBytes ?? MOTION_DEFAULT_WORKING_BYTES;
	assertMotionWorkingBudget(motionSurfaceLength(composition.width, composition.height) * Float32Array.BYTES_PER_ELEMENT * (sampling.samples.length > 1 ? 3 : 1), maximum);
	let lease: MotionCompositionLinkRasterLease | null = null; let released = false;
	try {
		lease = await options.acquire(offer, options.signal); options.signal?.throwIfAborted();
		if (lease.expressionAudio && lease.expressionAudio.revision.digest !== offer.revision.digest) throw new RangeError('Linked expression audio belongs to a stale saved revision.');
		const retained = lease;
		const surface = await renderMotionTemporalSamples({ evaluator, plan: sampling, expressionAudio: lease.expressionAudio, signal: options.signal, maximumWorkingBytes: maximum,
			render: (frame, quality) => renderMotionCompositionFrame(frame, { rasterizer: retained.rasterizer, compositor: retained.compositor, signal: options.signal, ...quality }) });
		released = true; await lease.release(); options.signal?.throwIfAborted();
		return Object.freeze({ identity: Object.freeze({ projectId: offer.revision.projectId, compositionId: offer.compositionId, revisionDigest: offer.revision.digest }), time: Object.freeze(time), surface });
	} catch (error) {
		const cleanup: unknown[] = []; if (lease && !released) { try { await lease.release(); } catch (failure) { cleanup.push(failure); } }
		throw aggregateScapeErrors(error, cleanup, 'Linked motion render and closure release failed.');
	}
}
