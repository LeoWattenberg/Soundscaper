/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	UnifiedExactRenderPlanV14,
	UnifiedExactRenderTransitionNode,
} from '../common/editor/unified-exact-render-plan.ts';
import { resolveVideoTransitionV1 } from '../common/editor/video-transition-resolution.ts';

/** Map one exact sequence-frame rational to the selected V14 output ordinal. */
export function framescaperOpenFxOutputOrdinalV28(
	plan: UnifiedExactRenderPlanV14,
	position: Readonly<{ readonly num: number; readonly den: number }>,
): number {
	if (!Number.isSafeInteger(position?.num) || !Number.isSafeInteger(position?.den)
		|| position.den < 1 || position.num < 0) {
		throw new RangeError('OpenFX sequence position is not an exact non-negative rational.');
	}
	const numerator = BigInt(position.num) * BigInt(plan.timebase.sequenceRate.den)
		* BigInt(plan.output.frameRate.num);
	const denominator = BigInt(position.den) * BigInt(plan.timebase.sequenceRate.num)
		* BigInt(plan.output.frameRate.den);
	const ordinal = numerator / denominator;
	if (ordinal > BigInt(Number.MAX_SAFE_INTEGER) || ordinal >= BigInt(plan.output.frameCount)) {
		throw new RangeError('OpenFX output ordinal exceeds the exact V14 range.');
	}
	return Number(ordinal);
}

/** Main and renderer independently derive the identical host-owned Transition value. */
export function framescaperOpenFxTransitionProgressV28(
	plan: UnifiedExactRenderPlanV14,
	transitionId: string,
	outputOrdinal: number,
): number {
	const transition = plan.nodes.find((node): node is UnifiedExactRenderTransitionNode => (
		node.kind === 'transition' && node.transition.id === transitionId
	));
	if (!transition) throw new ReferenceError('The OpenFX Transition attachment is unavailable.');
	if (!Number.isSafeInteger(outputOrdinal) || outputOrdinal < 0
		|| outputOrdinal >= plan.output.frameCount) throw new RangeError('The OpenFX output ordinal is invalid.');
	const sample = BigInt(plan.timebase.sampleStart) + BigInt(outputOrdinal)
		* BigInt(plan.timebase.sampleRate) * BigInt(plan.output.frameRate.den)
		/ BigInt(plan.output.frameRate.num);
	const rate = plan.timebase.sequenceRate;
	let frame = sample * BigInt(rate.num)
		/ (BigInt(rate.den) * BigInt(plan.timebase.sampleRate));
	const boundary = (value: bigint) => {
		const numerator = value * BigInt(rate.den) * BigInt(plan.timebase.sampleRate);
		const denominator = BigInt(rate.num);
		return numerator / denominator + ((numerator % denominator) * 2n >= denominator ? 1n : 0n);
	};
	while (frame > 0n && boundary(frame) > sample) frame -= 1n;
	while (boundary(frame + 1n) <= sample) frame += 1n;
	if (frame > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('OpenFX Transition frame exceeds safe domain.');
	return resolveVideoTransitionV1(transition.transition, transition.edges, Number(frame)).progress;
}
