/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCompositionFrame, MotionSceneEvaluator } from './motion-composition-evaluation.ts';
import type { MotionExpressionAudioPreparation } from './motion-expression-audio-preparation.ts';
import { createMotionAmplitudeNativeBudget } from './motion-expression-audio-energy.ts';
import { createMotionExpressionBudget } from './motion-expression-evaluator.ts';
import { createMotionSceneWorkBudget } from './motion-scene-work-budget.ts';
import { assertMotionTemporalSamplePlan, type MotionTemporalSample, type MotionTemporalSamplePlan } from './motion-temporal-sampling.ts';
import { compareRationals } from './timeline-time.ts';

/** Await each consumer before evaluating another frame; work/analysis retries share the whole shutter budget. */
export async function visitMotionTemporalSamples(options: Readonly<{
	evaluator: MotionSceneEvaluator; plan: MotionTemporalSamplePlan; expressionAudio?: MotionExpressionAudioPreparation;
	signal?: AbortSignal; maximumSceneWork?: number; maximumExpressionOperations?: number;
	visit: (sample: MotionTemporalSample, frame: MotionCompositionFrame) => Promise<void>;
}>): Promise<void> {
	assertMotionTemporalSamplePlan(options.plan); options.signal?.throwIfAborted();
	const sceneWork = createMotionSceneWorkBudget(options.maximumSceneWork ?? 262_144, options.signal);
	const expressionBudget = createMotionExpressionBudget({ maximumOperations: options.maximumExpressionOperations ?? 1_000_000, ...(options.signal ? { signal: options.signal } : {}) });
	const nativeBudget = createMotionAmplitudeNativeBudget(4_194_304);
	for (const sample of options.plan.samples) {
		options.signal?.throwIfAborted(); const request = { compositionId: options.plan.compositionId, time: sample.time };
		const frame = options.expressionAudio ? await options.expressionAudio.evaluate(query => options.evaluator.evaluate(request, { ...query, expressionBudget, sceneWork }), options.signal, nativeBudget)
			: options.evaluator.evaluate(request, { expressionBudget, sceneWork, ...(options.signal ? { signal: options.signal } : {}) });
		if (frame.compositionId !== request.compositionId || compareRationals(frame.time, request.time) !== 0 || frame.width !== options.plan.width || frame.height !== options.plan.height) throw new Error('Temporal evaluator returned a different composition, time or dimensions.');
		await options.visit(sample, frame); options.signal?.throwIfAborted();
		// CPU-only visitors must still service cancellation between expensive subframes.
		if (options.plan.samples.length > 1) { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); options.signal?.throwIfAborted(); }
	}
}
