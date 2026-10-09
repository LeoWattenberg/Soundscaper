/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import { createSelectedExactFrameResourceCore } from './selected-finishing-exact-frame-core.ts';
import type { SelectedExactFrameExecutionOptions } from './selected-finishing-exact-frame-contract.ts';

/** Current Frame generation16, with complete V2 picture admission and all
 * active native surfaces captured before current-stage LUT acquisition. */
export function createFramescaperSelectedExactFrameExecutionV16(options: SelectedExactFrameExecutionOptions<UnifiedExactRenderPlanV16>) {
	return createSelectedExactFrameResourceCore(options);
}
