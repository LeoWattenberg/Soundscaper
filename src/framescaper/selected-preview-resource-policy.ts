/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoEffectsV2 } from '../common/editor/video-effects-v2.ts';
import type { UnifiedExactRenderPlanV13 } from '../common/editor/unified-exact-render-plan.ts';
import type { UnifiedExactRenderPlanV16 } from '../common/editor/unified-exact-render-plan-v16.ts';

/** Select the named successor from a completely admitted current document.
 * Disabled/null envelopes still require V2 admission and retain their custody. */
export function hasSelectedCubeLutPictureV2(project: Readonly<Record<string, unknown>>): boolean {
	if (!Array.isArray(project.clips)) throw new TypeError('Selected preview clips are required.');
	const bin = project.projectBin as Readonly<{ clips: readonly Readonly<Record<string, unknown>>[] }>;
	return [...project.clips, ...(bin?.clips ?? [])].some((clip: Readonly<Record<string, unknown>>) => clip.kind === 'video'
		&& normalizeVideoEffectsV2(clip.videoEffects ?? []).some(effect => effect.type === 'cube-lut-profile-v1'));
}

/** Existing GradeV27 resources also require the exact playing route. Ordinary
 * numeric/shader playing stacks retain their established evaluation path. */
export function requiresSelectedExactPlaying(plan: UnifiedExactRenderPlanV13 | UnifiedExactRenderPlanV16): boolean {
	return plan.nodes.some(node => node.kind === 'clip'
		? node.pictureState.videoEffects.some(effect => effect.enabled && effect.type === 'cube-lut-profile-v1' && effect.params.lut !== null)
		: node.kind === 'finishing' && node.visualPresentations.some(presentation => presentation.enabled && presentation.grade?.lut != null));
}
