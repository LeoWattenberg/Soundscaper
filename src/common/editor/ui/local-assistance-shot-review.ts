/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer projection of the common Fast/Accurate shot semantic reviewer. */

import {
	reviewAssistanceShotBoundariesV1,
	type AssistanceShotBoundariesReviewV1,
	type AssistanceShotBoundaryReviewV1,
} from '../assistance/shot-boundaries-v1.ts';

export type LocalAssistanceShotBoundaryReview = AssistanceShotBoundaryReviewV1;

export interface LocalAssistanceShotBoundariesReview extends AssistanceShotBoundariesReviewV1 {
	readonly kind: 'shot-boundaries';
}

export function reviewLocalAssistanceShotBoundaries(
	value: unknown,
): LocalAssistanceShotBoundariesReview {
	const reviewed = reviewAssistanceShotBoundariesV1(value);
	return Object.freeze({
		kind: 'shot-boundaries', ...reviewed,
	});
}
