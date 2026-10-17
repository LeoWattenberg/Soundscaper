/* SPDX-License-Identifier: AGPL-3.0-only */
import type { UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import { assertUnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import type { UnifiedExactRenderTimingSidecars } from '../common/editor/unified-exact-render-timing-authority.ts';
import { captureCurrentImageExecutionOptionsV16, createTimelineImageExecutionCore } from './video-export-image-execution-timeline-image-core.ts';
const CHECK = AbortSignal.prototype.throwIfAborted;
/** Current image execution preserves complete16 resource ordering and custody. */
export async function createFramescaperVideoExportImageExecutionTimelineImageV16(options: Omit<Parameters<typeof createTimelineImageExecutionCore>[0], 'foundationPlan'> & Readonly<{ foundationPlan: UnifiedExactRenderPlanV16; timingSidecars?: UnifiedExactRenderTimingSidecars }>) {
	const captured = captureCurrentImageExecutionOptionsV16(options);
	try {
		assertUnifiedExactRenderPlanV16(captured.foundationPlan, captured.timingSidecars);
		return await createTimelineImageExecutionCore(captured, true);
	} catch (error) { Reflect.apply(CHECK, captured.signal, []); throw error; }
}
