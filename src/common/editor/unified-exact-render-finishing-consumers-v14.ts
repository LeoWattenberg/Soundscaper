/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createUnifiedExactRenderPlan,
	createUnifiedExactRenderPlanWithTimingSidecars,
	assertUnifiedExactRenderPlanV14,
	assertUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV13,
	type UnifiedExactRenderPlanV14,
	type UnifiedExactRenderTimingSidecars,
} from './unified-exact-render-plan.ts';
import {
	createUnifiedExactRenderFinishingExportConsumerV13,
	createUnifiedExactRenderFinishingPreviewConsumerV13,
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
	const consumer = createUnifiedExactRenderFinishingPreviewConsumerV13(
		finishingFoundation(plan, timingSidecars), timingSidecars,
	);
	return Object.freeze({ plan, resolveFrame: consumer.resolveFrame });
}

/** Preview and export deliberately share the same detached finishing foundation. */
export function createUnifiedExactRenderFinishingExportConsumerV14(
	plan: UnifiedExactRenderPlanV14,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderFinishingConsumerV14 {
	const consumer = createUnifiedExactRenderFinishingExportConsumerV13(
		finishingFoundation(plan, timingSidecars), timingSidecars,
	);
	return Object.freeze({ plan, resolveFrame: consumer.resolveFrame });
}

function finishingFoundation(
	plan: UnifiedExactRenderPlanV14,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
): UnifiedExactRenderPlanV13 {
	if (timingSidecars === undefined) assertUnifiedExactRenderPlanV14(plan);
	else {
		assertUnifiedExactRenderPlanWithTimingSidecars(plan, timingSidecars);
		if (plan.version !== 14) throw new RangeError('Selected V14 finishing requires a V14 plan.');
	}
	const candidate = structuredClone(plan) as unknown as Record<string, unknown>;
	candidate.version = 13;
	candidate.nodes = plan.nodes.filter(({ kind }) => kind !== 'professional-media' && kind !== 'openfx');
	const foundation = timingSidecars === undefined
		? createUnifiedExactRenderPlan(candidate)
		: createUnifiedExactRenderPlanWithTimingSidecars(candidate, timingSidecars);
	if (foundation.version !== 13) throw new Error('V14 finishing projection did not produce V13.');
	return foundation as UnifiedExactRenderPlanV13;
}
