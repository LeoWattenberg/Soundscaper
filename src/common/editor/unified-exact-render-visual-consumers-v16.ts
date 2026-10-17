/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertUnifiedExactRenderPlanV16, type UnifiedExactRenderPlanV16 } from './unified-exact-render-plan-v16.ts';
import type { UnifiedExactRenderTimingSidecars } from './unified-exact-render-timing-authority.ts';
import { createExactVisualConsumerCore, type ExactVisualConsumerCore } from './unified-exact-render-visual-consumers-core.ts';
export type UnifiedExactRenderVisualConsumerV16 = ExactVisualConsumerCore<UnifiedExactRenderPlanV16>;

export function createUnifiedExactRenderVisualPreviewConsumerV16(plan: UnifiedExactRenderPlanV16,
	timingSidecars?: UnifiedExactRenderTimingSidecars,
	options?: Readonly<{ readonly allowExternalGenerators?: boolean }>): UnifiedExactRenderVisualConsumerV16 {
	assertUnifiedExactRenderPlanV16(plan, timingSidecars);
	return createExactVisualConsumerCore(plan, options);
}
export const createUnifiedExactRenderVisualExportConsumerV16 = createUnifiedExactRenderVisualPreviewConsumerV16;
