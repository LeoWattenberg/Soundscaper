/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import { createSelectedExactPreviewLegacyCore, type SelectedExactPreviewOptions } from './editor-selected-finishing-exact-preview-core.ts';
export type { FramescaperSelectedExactPreviewFinishing } from './editor-selected-finishing-exact-preview-core.ts';

/** The named legacy entry retains generation13 admission and disposal. */
export function createFramescaperSelectedExactPreviewFinishing(options: SelectedExactPreviewOptions<UnifiedExactRenderPlanV13>) {
	return createSelectedExactPreviewLegacyCore(options);
}
