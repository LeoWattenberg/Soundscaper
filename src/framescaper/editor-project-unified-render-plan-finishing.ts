/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	UnifiedExactRenderPlanV13,
} from '../common/editor/unified-exact-render-plan.ts';
import {
	snapshotFramescaperUnifiedExactVisualRenderAuthority,
	type FramescaperUnifiedExactVisualRenderAuthority,
} from './editor-project-unified-render-authority.ts';
import {
	createFramescaperUnifiedRenderFoundation,
	finalizeFramescaperUnifiedRenderPlan,
} from './editor-project-unified-render-core.ts';
import { createFramescaperUnifiedVisualRenderNodes } from './editor-project-unified-render-visual.ts';
import { validateFramescaperProjectFinishing, type FramescaperProjectFinishing } from './editor-project-finishing.ts';
import { createFramescaperUnifiedFinishingNode } from './editor-project-unified-render-finishing-node.ts';

export type { FramescaperUnifiedExactVisualRenderAuthority };

/** Adapt selected finishing directly from visual visual lineage into exact V13 authority. */
export function createFramescaperProjectUnifiedExactRenderPlanFinishing(
	profile: unknown,
	projectValue: unknown,
	authorityValue: unknown,
): UnifiedExactRenderPlanV13 {
	validateFramescaperProjectFinishing(profile, projectValue);
	const project = projectValue as FramescaperProjectFinishing;
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(authorityValue);
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const finishing = createFramescaperUnifiedFinishingNode(project, foundation.projectIdentities, authority.sequenceId);
	const plan = finalizeFramescaperUnifiedRenderPlan(
		foundation, 13, [...visual.nodes, finishing],
	);
	return plan;
}
