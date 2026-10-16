/* SPDX-License-Identifier: AGPL-3.0-only */

import type { TakeCompDialogGroupModel } from '../take-comp-dialog-model.ts';

export interface TakePromotionRange {
	readonly startSample: number;
	readonly endSample: number;
}

/** Only captured samples of the selected take are eligible for promotion. */
export function takePromotionBounds(
	group: TakeCompDialogGroupModel | null,
	takeId: string | null,
): TakePromotionRange | null {
	const take = group?.takes.find(take => take.id === takeId);
	return take ? { startSample: take.startSample, endSample: take.endSample } : null;
}

/** Retain an overlapping user range, or seed the newly selected available span. */
export function reconcileTakePromotionRange(
	bounds: TakePromotionRange | null,
	startSample: number,
	endSample: number,
): TakePromotionRange {
	if (!bounds) return { startSample: 0, endSample: 1 };
	const start = Math.max(bounds.startSample, Math.min(bounds.endSample, startSample));
	const end = Math.max(bounds.startSample, Math.min(bounds.endSample, endSample));
	return end > start ? { startSample: start, endSample: end } : bounds;
}
