/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertUnifiedExactRenderPlanV14,
	assertUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV13,
	type UnifiedExactRenderPlanV14,
	type UnifiedExactRenderTimingSidecars,
} from './unified-exact-render-plan.ts';
import {
	createUnifiedExactRenderFinishingConsumerForValidatedFoundation,
	type UnifiedExactRenderFinishingFrameRequestV13,
	type UnifiedExactRenderRgbaFrameV13,
} from './unified-exact-render-finishing-consumers-v13.ts';

export interface UnifiedExactRenderFinishingConsumerV14 {
	readonly plan: UnifiedExactRenderPlanV14;
	resolveFrame(request: UnifiedExactRenderFinishingFrameRequestV13): Promise<UnifiedExactRenderRgbaFrameV13>;
}

/** Run selected finishing against V14 while native professional/OFX nodes stay externally owned. */
export function createUnifiedExactRenderFinishingPreviewConsumerV14(
	plan: UnifiedExactRenderPlanV14,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderFinishingConsumerV14 {
	const consumer = createUnifiedExactRenderFinishingConsumerForValidatedFoundation(
		finishingFoundation(plan, timingSidecars),
	);
	return Object.freeze({ plan, resolveFrame: consumer.resolveFrame });
}

/** Preview and export deliberately share the same detached finishing foundation. */
export function createUnifiedExactRenderFinishingExportConsumerV14(
	plan: UnifiedExactRenderPlanV14,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderFinishingConsumerV14 {
	const consumer = createUnifiedExactRenderFinishingConsumerForValidatedFoundation(
		finishingFoundation(plan, timingSidecars),
	);
	return Object.freeze({ plan, resolveFrame: consumer.resolveFrame });
}

/**
 * Validate as V14, then hand the resolver the plan with its externally-owned
 * native nodes stripped. Validation authority stays with V14: re-deriving a
 * V13 wire here would refuse the deliveryProfile field and every professional
 * container tuple V13 never admits, so every V14 consumer threw before it
 * could resolve a single finishing frame.
 */
function finishingFoundation(
	plan: UnifiedExactRenderPlanV14,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderPlanV13 {
	if (timingSidecars === undefined) assertUnifiedExactRenderPlanV14(plan);
	else {
		assertUnifiedExactRenderPlanWithTimingSidecars(plan, timingSidecars);
		if (plan.version !== 14) throw new RangeError('Selected V14 finishing requires a V14 plan.');
	}
	return Object.freeze({
		...plan,
		nodes: Object.freeze(
			plan.nodes.filter(({ kind }) => kind !== 'professional-media' && kind !== 'openfx'),
		),
	}) as unknown as UnifiedExactRenderPlanV13;
}
