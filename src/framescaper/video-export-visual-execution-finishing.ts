/* SPDX-License-Identifier: AGPL-3.0-only */
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from './editor-project-unified-render-plan-finishing.ts';
import { createFramescaperVideoExportVisualExecutionCore, type CreateRequest, type FramescaperVideoExportPictureDispositionCore, type FramescaperVideoExportVisualExecutionCore } from './video-export-visual-execution-core.ts';
export type { FramescaperVideoExportVisualAssetStoreFinishing } from './video-export-visual-assets-finishing.ts';
export type FramescaperVideoExportPictureDispositionFinishing = FramescaperVideoExportPictureDispositionCore<13>;
export type FramescaperVideoExportVisualExecutionFinishing = FramescaperVideoExportVisualExecutionCore<UnifiedExactRenderPlanV13>;
export function createFramescaperVideoExportVisualExecutionFinishing(request: CreateRequest): Promise<FramescaperVideoExportVisualExecutionFinishing> {
	return createFramescaperVideoExportVisualExecutionCore(request, createFramescaperProjectUnifiedExactRenderPlanFinishing);
}
