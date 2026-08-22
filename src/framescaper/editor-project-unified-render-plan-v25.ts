/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertUnifiedExactRenderPlanV11,
	type UnifiedExactRenderPlanV11,
} from '../common/editor/unified-exact-render-plan.ts';
import {
	snapshotFramescaperUnifiedExactVisualRenderAuthority,
	type FramescaperUnifiedExactVisualRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
} from './editor-project-unified-render-core.ts';
import { createFramescaperUnifiedProfessionalRenderNodes } from './editor-project-unified-render-professional.ts';
import { createFramescaperUnifiedVisualRenderNodes } from './editor-project-unified-render-visual.ts';
import { validateFramescaperProjectV25 } from './editor-project-v25-validation.ts';

/** Adapt one authenticated dormant V25 document to cumulative exact render plan V11. */
export function createFramescaperProjectUnifiedExactRenderPlanV25(
	profile: unknown,
	project: unknown,
	authorityValue: unknown,
): UnifiedExactRenderPlanV11 {
	validateFramescaperProjectV25(profile, project);
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(authorityValue);
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const professional = createFramescaperUnifiedProfessionalRenderNodes(foundation);
	const plan = finalizeFramescaperUnifiedRenderPlan(
		foundation, 11, [...visual.nodes, ...professional],
	);
	assertUnifiedExactRenderPlanV11(plan);
	return plan;
}

export type { FramescaperUnifiedExactVisualRenderAuthority };
