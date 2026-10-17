/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertUnifiedExactRenderPlanV16, type UnifiedExactRenderPlanV16 } from './unified-exact-render-plan-v16.ts';
import type { UnifiedExactRenderTimingSidecars } from './unified-exact-render-timing-authority.ts';
import { createExactFinishingConsumerCore, type ExactFinishingConsumerCore } from './unified-exact-render-finishing-consumers-core.ts';
export type UnifiedExactRenderFinishingConsumerV16 = ExactFinishingConsumerCore<UnifiedExactRenderPlanV16>;

export function createUnifiedExactRenderFinishingPreviewConsumerV16(plan: UnifiedExactRenderPlanV16,
	timingSidecars?: UnifiedExactRenderTimingSidecars): UnifiedExactRenderFinishingConsumerV16 {
	assertUnifiedExactRenderPlanV16(plan, timingSidecars);
	return createExactFinishingConsumerCore(plan);
}
export const createUnifiedExactRenderFinishingExportConsumerV16 = createUnifiedExactRenderFinishingPreviewConsumerV16;
