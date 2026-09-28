/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderPlanV13 } from './unified-exact-render-plan.ts';

/** Resolve a sequence position through the sample grid used by V13 preview and export. */
export function sampleAtSequencePosition(
	position: Readonly<{ num: number; den: number }>, plan: UnifiedExactRenderPlanV13,
): number {
	const { sequenceRate, sampleRate } = plan.timebase;
	return Math.round(position.num / position.den * sampleRate * sequenceRate.den / sequenceRate.num);
}

/** Map the point-rounded sample to the selected output video frame. */
export function outputAtSequencePosition(
	position: Readonly<{ num: number; den: number }>, plan: UnifiedExactRenderPlanV13,
	outputRate = plan.output.frameRate,
): number {
	const sample = sampleAtSequencePosition(position, plan);
	return Math.round(sample * outputRate.num / (plan.timebase.sampleRate * outputRate.den));
}
