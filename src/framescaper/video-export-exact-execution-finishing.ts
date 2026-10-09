/* SPDX-License-Identifier: AGPL-3.0-only */
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing } from './selected-finishing-exact-frame-execution.ts';
import { createFramescaperVideoExportVisualExecutionFinishing } from './video-export-visual-execution-finishing.ts';
import { createFramescaperVideoExportExactExecutionCore, type ExactExecutionRequestCore, type CreateOpenFxExecutionCore, type CreateSupplementalExecutionCore, type FramescaperVideoExportExactExecutionCore } from './video-export-exact-execution-core.ts';
export type { FramescaperVideoExportSupplementalPictureExecutionFinishing } from './video-export-exact-execution-core.ts';
export type CreateFramescaperOpenFxExactExecutionNativeMedia = CreateOpenFxExecutionCore<UnifiedExactRenderPlanV13>;
export type CreateFramescaperVideoExportSupplementalPictureExecutionFinishing = CreateSupplementalExecutionCore<UnifiedExactRenderPlanV13>;
export type FramescaperVideoExportExactExecutionFinishing = FramescaperVideoExportExactExecutionCore<13>;
export function createFramescaperVideoExportExactExecutionFinishing(options: ExactExecutionRequestCore<UnifiedExactRenderPlanV13>): Promise<FramescaperVideoExportExactExecutionFinishing> {
	return createFramescaperVideoExportExactExecutionCore(options, { createVisual: createFramescaperVideoExportVisualExecutionFinishing,
		createExact: createFramescaperSelectedExactFrameExecutionFinishing });
}
