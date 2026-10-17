/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import { createSelectedExactFrameLegacyCore } from './selected-finishing-exact-frame-core.ts';
import type { SelectedExactFrameExecutionOptions } from './selected-finishing-exact-frame-contract.ts';
export type { FramescaperSelectedExactFrameExecutionFinishing, FramescaperSelectedExactSupplementalPictureFinishing,
 CaptureFrameFinishing, ApplyEffectsFinishing } from './selected-finishing-exact-frame-contract.ts';

/** Original selected finishing generation13; complete V1 picture admission stays strict. */
export function createFramescaperSelectedExactFrameExecutionFinishing(options: SelectedExactFrameExecutionOptions<UnifiedExactRenderPlanV13>) {
	return createSelectedExactFrameLegacyCore(options);
}
