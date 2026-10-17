/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertUnifiedExactRenderPlanV13, assertUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV13 } from './unified-exact-render-plan.ts';
import type { UnifiedExactRenderTimingSidecars } from './unified-exact-render-timing-authority.ts';
import { createExactFinishingConsumerCore, type ExactFinishingConsumerCore } from './unified-exact-render-finishing-consumers-core.ts';
export type { UnifiedExactRenderRgbaFrameV13, UnifiedExactRenderFinishingProgressV13,
	UnifiedExactRenderFinishingFrameRequestV13 } from './unified-exact-render-finishing-consumers-core.ts';
export type UnifiedExactRenderFinishingConsumerV13 = ExactFinishingConsumerCore<UnifiedExactRenderPlanV13>;

/** Preview and export retain their exact named V13 admission. */
export function createUnifiedExactRenderFinishingPreviewConsumerV13(plan: UnifiedExactRenderPlanV13,
	timingSidecars?: UnifiedExactRenderTimingSidecars): UnifiedExactRenderFinishingConsumerV13 {
	return createConsumer(plan, timingSidecars);
}
export function createUnifiedExactRenderFinishingExportConsumerV13(plan: UnifiedExactRenderPlanV13,
	timingSidecars?: UnifiedExactRenderTimingSidecars): UnifiedExactRenderFinishingConsumerV13 {
	return createConsumer(plan, timingSidecars);
}
/** The existing V14 caller owns complete higher-generation admission. */
export function createUnifiedExactRenderFinishingConsumerForValidatedFoundation(plan: UnifiedExactRenderPlanV13): UnifiedExactRenderFinishingConsumerV13 {
	return createExactFinishingConsumerCore(plan);
}
function createConsumer(plan: UnifiedExactRenderPlanV13, timingSidecars?: UnifiedExactRenderTimingSidecars): UnifiedExactRenderFinishingConsumerV13 {
	if (timingSidecars === undefined) assertUnifiedExactRenderPlanV13(plan);
	else {
		assertUnifiedExactRenderPlanWithTimingSidecars(plan, timingSidecars);
		if (plan.version !== 13) throw new RangeError('Selected finishing requires a V13 plan.');
	}
	return createExactFinishingConsumerCore(plan);
}
