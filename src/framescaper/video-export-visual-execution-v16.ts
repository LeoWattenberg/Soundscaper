/* SPDX-License-Identifier: AGPL-3.0-only */
import type { UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from './editor-project-unified-render-plan-v16.ts';
import { createFramescaperVideoExportVisualExecutionCore, type CreateRequest, type FramescaperVideoExportPictureDispositionCore, type FramescaperVideoExportVisualExecutionCore } from './video-export-visual-execution-core.ts';
export type FramescaperVideoExportPictureDispositionV16 = FramescaperVideoExportPictureDispositionCore<16>;
export type FramescaperVideoExportVisualExecutionV16 = FramescaperVideoExportVisualExecutionCore<UnifiedExactRenderPlanV16>;
export function createFramescaperVideoExportVisualExecutionV16(request: CreateRequest): Promise<FramescaperVideoExportVisualExecutionV16> {
	return createFramescaperVideoExportVisualExecutionCore(request, createFramescaperProjectUnifiedExactRenderPlanV16);
}
