/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ExactConsumerPlanCore } from './unified-exact-render-consumer-plan-core.ts';
type TimingPlan = Pick<ExactConsumerPlanCore, 'timebase' | 'output'>;

/** Resolve a sequence position through the sample grid used by V13 preview and export. */
export function sampleAtSequencePosition(
	position: Readonly<{ num: number; den: number }>, plan: TimingPlan,
): number {
	const { sequenceRate, sampleRate } = plan.timebase;
	return Math.round(position.num / position.den * sampleRate * sequenceRate.den / sequenceRate.num);
}

/** Map the point-rounded sample to the selected output video frame. */
export function outputAtSequencePosition(
	position: Readonly<{ num: number; den: number }>, plan: TimingPlan,
	outputRate = plan.output.frameRate,
): number {
	const sample = sampleAtSequencePosition(position, plan);
	return Math.round(sample * outputRate.num / (plan.timebase.sampleRate * outputRate.den));
}
