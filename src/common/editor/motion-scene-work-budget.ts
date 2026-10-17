/* SPDX-License-Identifier: AGPL-3.0-only */
import { motionInteger } from './motion-values.ts';
export interface MotionSceneWorkBudget { readonly remaining: number; consume(): void }
/** Counts composition, layer, audio-placement and uncached state/matrix visits across a whole shutter. */
export function createMotionSceneWorkBudget(maximum = 65_536, signal?: AbortSignal): MotionSceneWorkBudget {
	let remaining = motionInteger(maximum, 'motion scene work budget', 1, 1_048_576);
	return Object.freeze({ get remaining() { return remaining; }, consume() {
		signal?.throwIfAborted(); if (remaining <= 0) throw new RangeError('Motion scene work budget exceeded.'); remaining--;
	} });
}
