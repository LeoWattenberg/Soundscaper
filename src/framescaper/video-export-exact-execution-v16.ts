/* SPDX-License-Identifier: AGPL-3.0-only */
import type { UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-timing-authority.ts';
import { createFramescaperSelectedExactFrameExecutionV16 } from './selected-finishing-exact-frame-execution-v16.ts';
import { createFramescaperVideoExportVisualExecutionV16 } from './video-export-visual-execution-v16.ts';
import { restoreFramescaperResourceCarrierLayersV16 } from './video-export-resource-carrier-v16.ts';
import { createFramescaperVideoExportExactExecutionCore, type ExactExecutionRequestCore, type FramescaperVideoExportExactExecutionCore, type CreateOpenFxExecutionCore, type CreateSupplementalExecutionCore } from './video-export-exact-execution-core.ts';
export type CreateFramescaperOpenFxExactExecutionV16 = CreateOpenFxExecutionCore<UnifiedExactRenderPlanV16>;
export type CreateFramescaperSupplementalPictureExecutionV16 = (options: Parameters<CreateSupplementalExecutionCore<UnifiedExactRenderPlanV16>>[0] & Readonly<{ timingSidecars?: UnifiedExactRenderTimingSidecars }>) => ReturnType<CreateSupplementalExecutionCore<UnifiedExactRenderPlanV16>>;
export type FramescaperVideoExportExactExecutionV16 = FramescaperVideoExportExactExecutionCore<16>;
export function createFramescaperVideoExportExactExecutionV16(options: ExactExecutionRequestCore<UnifiedExactRenderPlanV16>): Promise<FramescaperVideoExportExactExecutionV16> {
	return createFramescaperVideoExportExactExecutionCore(options, { createVisual: createFramescaperVideoExportVisualExecutionV16,
		createExact: createFramescaperSelectedExactFrameExecutionV16, restoreLayers: restoreFramescaperResourceCarrierLayersV16 });
}
