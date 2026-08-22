/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertUnifiedExactRenderPlanV9,
	type UnifiedExactRenderPlanV9,
} from '../common/editor/unified-exact-render-plan.ts';
import {
	snapshotFramescaperUnifiedExactRenderAuthority,
	type FramescaperUnifiedExactRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
} from './editor-project-unified-render-core.ts';
import { validateFramescaperProjectV22 } from './editor-project-v22-validation.ts';

export type { FramescaperUnifiedExactRenderAuthority };

/** Adapt one authenticated dormant V22 document to exact render plan V9. */
export function createFramescaperProjectUnifiedExactRenderPlanV22(
	profile: unknown,
	project: unknown,
	authorityValue: unknown,
): UnifiedExactRenderPlanV9 {
	validateFramescaperProjectV22(profile, project);
	const authority = snapshotFramescaperUnifiedExactRenderAuthority(authorityValue);
	const plan = finalizeFramescaperUnifiedRenderPlan(
		createFramescaperUnifiedRenderFoundation(project, authority),
		9,
		[],
	);
	assertUnifiedExactRenderPlanV9(plan);
	return plan;
}
