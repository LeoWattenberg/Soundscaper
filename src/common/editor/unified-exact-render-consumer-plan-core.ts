/* SPDX-License-Identifier: AGPL-3.0-only */

import type { UnifiedExactRenderClipNode, UnifiedExactRenderNode, UnifiedExactRenderPlan } from './unified-exact-render-plan.ts';

/** Finishing/visual kernels consume scalar placement and finishing authority.
 * They do not normalize or execute the generation-owned picture effect stack.
 * Public generation wrappers authenticate that complete stack before entering
 * this fixed internal core; no V2 picture is cast into a V1 picture schema. */
export type ExactConsumerClipCore = Omit<UnifiedExactRenderClipNode, 'pictureState'>;
export type ExactConsumerNodeCore = Exclude<UnifiedExactRenderNode, { kind: 'clip' }> | ExactConsumerClipCore;
export interface ExactConsumerPlanCore extends Pick<UnifiedExactRenderPlan,
	'strategy' | 'project' | 'format' | 'codecs' | 'timebase' | 'output' | 'tracks' | 'sources'> {
	readonly version: number;
	readonly nodes: readonly ExactConsumerNodeCore[];
}
