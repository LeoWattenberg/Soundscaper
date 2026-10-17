/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import { createSelectedExactPreviewResourceCore, createSelectedExactPreviewJoinedLegacyCore, type SelectedExactPreviewOptions, type SelectedExactPreviewResourceOptions } from './editor-selected-finishing-exact-preview-core.ts';
export type { FramescaperSelectedExactPreviewV16 } from './editor-selected-finishing-exact-preview-core.ts';

/** Resource-capable current Frame preview owns a joined retirement barrier. */
export function createFramescaperSelectedExactPreviewV16(options: SelectedExactPreviewResourceOptions) {
	return createSelectedExactPreviewResourceCore(options);
}

/** Current no-resource/OpenFX preview keeps the strict13 plan while gaining a
 * joined target lifetime; the old named preview factory remains unchanged. */
export function createFramescaperSelectedExactPreviewJoinedV13(options: SelectedExactPreviewOptions<UnifiedExactRenderPlanV13>) {
	return createSelectedExactPreviewJoinedLegacyCore(options);
}
