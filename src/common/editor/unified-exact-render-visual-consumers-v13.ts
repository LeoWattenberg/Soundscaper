/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertUnifiedExactRenderPlanV13, assertUnifiedExactRenderPlanWithTimingSidecars,
	type UnifiedExactRenderPlanV13 } from './unified-exact-render-plan.ts';
import type { UnifiedExactRenderTimingSidecars } from './unified-exact-render-timing-authority.ts';
import { createExactVisualConsumerCore, type ExactVisualConsumerCore } from './unified-exact-render-visual-consumers-core.ts';
export type { UnifiedExactRenderActiveAdjustmentV13, UnifiedExactRenderVisualFrameEntryV13,
	UnifiedExactRenderVisualFrameRequestV13, UnifiedExactRenderVisualFrameV13, UnifiedExactRenderVisualFrameLayerV13,
	UnifiedExactRenderTransitionWeightV13, UnifiedExactRenderVisualFrameLedgerV13,
	UnifiedExactRenderVisualPresentationStateV13 } from './unified-exact-render-visual-consumers-core.ts';
export type UnifiedExactRenderVisualConsumerV13 = ExactVisualConsumerCore<UnifiedExactRenderPlanV13>;

export function createUnifiedExactRenderVisualPreviewConsumerV13(plan: UnifiedExactRenderPlanV13,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
	options?: Readonly<{ readonly allowExternalGenerators?: boolean }>): UnifiedExactRenderVisualConsumerV13 {
	if (timingSidecars === undefined) assertUnifiedExactRenderPlanV13(plan);
	else {
		assertUnifiedExactRenderPlanWithTimingSidecars(plan, timingSidecars);
		if (plan.version !== 13) throw new RangeError('V13 visual execution requires a V13 plan.');
	}
	return createExactVisualConsumerCore(plan, options);
}
export const createUnifiedExactRenderVisualExportConsumerV13 = createUnifiedExactRenderVisualPreviewConsumerV13;
export { resolveUnifiedExactRenderVisualPresentationV13 } from './unified-exact-render-visual-consumers-core.ts';
