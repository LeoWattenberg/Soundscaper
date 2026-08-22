/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertUnifiedExactRenderPlanV12,
	type UnifiedExactRenderPlanV12,
} from '../common/editor/unified-exact-render-plan.ts';
import {
	snapshotFramescaperUnifiedExactVisualRenderAuthority,
	type FramescaperUnifiedExactVisualRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
} from './editor-project-unified-render-core.ts';
import { createFramescaperUnifiedOpenFxRenderNodes } from './editor-project-unified-render-openfx.ts';
import { createFramescaperUnifiedProfessionalRenderNodes } from './editor-project-unified-render-professional.ts';
import { createFramescaperUnifiedVisualRenderNodes } from './editor-project-unified-render-visual.ts';
import { validateFramescaperProjectV26 } from './editor-project-v26-validation.ts';

/** Adapt one authenticated dormant V26 document to cumulative exact render plan V12. */
export function createFramescaperProjectUnifiedExactRenderPlanV26(
	profile: unknown,
	project: unknown,
	authorityValue: unknown,
): UnifiedExactRenderPlanV12 {
	validateFramescaperProjectV26(profile, project);
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(authorityValue);
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const professional = createFramescaperUnifiedProfessionalRenderNodes(foundation);
	const openFx = createFramescaperUnifiedOpenFxRenderNodes(
		foundation, visual.representedIdentities,
	);
	const plan = finalizeFramescaperUnifiedRenderPlan(
		foundation, 12, [...visual.nodes, ...professional, ...openFx],
	);
	assertUnifiedExactRenderPlanV12(plan);
	return plan;
}

export type { FramescaperUnifiedExactVisualRenderAuthority };
