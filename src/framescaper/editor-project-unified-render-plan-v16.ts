/* SPDX-License-Identifier: AGPL-3.0-only */

import { createUnifiedExactRenderPlanV16, type UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';
import { snapshotFramescaperUnifiedExactVisualRenderAuthority } from './editor-project-unified-render-authority.ts';
import { createFramescaperUnifiedRenderFoundation, snapshotFramescaperUnifiedRenderTimingSidecars } from './editor-project-unified-render-core.ts';
import { createFramescaperUnifiedVisualRenderNodes } from './editor-project-unified-render-visual.ts';
import { createFramescaperUnifiedFinishingNode } from './editor-project-unified-render-finishing-node.ts';
import { validateFramescaperProjectFinishing, type FramescaperProjectFinishing } from './editor-project-finishing.ts';

/** Current Frame explicitly selects the resource-capable picture generation.
 * The common foundation carries raw scalar graph records, never a V1 cast of
 * references; only this named final owner admits its complete V2 picture.
 * The existing named final9–15 owners and selected13 adapter remain strict. */
export function createFramescaperProjectUnifiedExactRenderPlanV16(profile: unknown,
	projectValue: unknown, authorityValue: unknown): UnifiedExactRenderPlanV16 {
	validateFramescaperProjectFinishing(profile, projectValue);
	const project = projectValue as FramescaperProjectFinishing;
	const authority = snapshotFramescaperUnifiedExactVisualRenderAuthority(authorityValue);
	const foundation = createFramescaperUnifiedRenderFoundation(project, authority);
	const visual = createFramescaperUnifiedVisualRenderNodes(foundation, authority);
	const finishing = createFramescaperUnifiedFinishingNode(project, foundation.projectIdentities, authority.sequenceId);
	return createUnifiedExactRenderPlanV16({ ...foundation.rawPlanBase, version: 16,
		nodes: [...foundation.baseNodes, ...visual.nodes, finishing] }, snapshotFramescaperUnifiedRenderTimingSidecars(foundation));
}
