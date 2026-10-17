/* SPDX-License-Identifier: AGPL-3.0-only */
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import { createTimelineImageExecutionCore } from './video-export-image-execution-timeline-image-core.ts';
/** The legacy image executor retains its fixed13 public plan contract. */
export function createFramescaperVideoExportImageExecutionTimelineImage(options: Omit<Parameters<typeof createTimelineImageExecutionCore>[0], 'foundationPlan'> & Readonly<{ foundationPlan: UnifiedExactRenderPlanV13 }>) {
	return createTimelineImageExecutionCore(options);
}
