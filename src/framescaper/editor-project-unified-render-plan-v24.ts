/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderPlanV10 } from '../common/editor/unified-exact-render-plan.ts';
import {
	snapshotFramescaperUnifiedExactVisualRenderAuthority,
	type FramescaperUnifiedExactVisualRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
} from './editor-project-unified-render-core.ts';
import { createFramescaperUnifiedVisualRenderNodes } from './editor-project-unified-render-visual.ts';
import { validateFramescaperProjectV24 } from './editor-project-v24-validation.ts';

export type { FramescaperUnifiedExactVisualRenderAuthority };

/** Adapt one authenticated dormant V24 document to cumulative exact render plan V10. */
export function createFramescaperProjectUnifiedExactRenderPlanV24(
	profile: unknown,
	project: unknown,
	authorityValue: unknown,
): UnifiedExactRenderPlanV10 {
	validateFramescaperProjectV24(profile, project);
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(authorityValue);
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const plan = finalizeFramescaperUnifiedRenderPlan(foundation, 10, visual.nodes);
	return plan;
}
