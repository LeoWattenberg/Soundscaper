/* SPDX-License-Identifier: AGPL-3.0-only */

import * as legacy from './video-keyframe-carrier.ts';
import { FRAME_VIDEO_KEYFRAME_CARRIERS_V2 } from './video-keyframe-carrier-v2.ts';
import { cloneVideoEffects } from '../video-effects.js';
import { normalizeVideoEffectsV2 } from '../video-effects-v2.ts';
import { videoKeyframeCurvesEqual } from '../video-keyframe-curves.ts';
import { videoKeyframeCurvesEqualV2 } from '../video-keyframe-curves-v2.ts';

const CURRENT_COMMAND_PROJECTS = new WeakSet<object>();

/** Granted only by the named current Frame transaction after full admission.
 * The marker is transient and cannot be carried by persisted JSON or a spread. */
export function brandFrameResourceCommandProjectV2(project: object): void {
	CURRENT_COMMAND_PROJECTS.add(project);
}
export function isFrameResourceCommandProjectV2(project: unknown): boolean {
	return current(project);
}
export function frameCommandCarriersV2(project: unknown) {
	return current(project) ? FRAME_VIDEO_KEYFRAME_CARRIERS_V2 : legacy;
}
export function frameCommandKeyframesEqualV2(project: unknown): typeof videoKeyframeCurvesEqual {
	return current(project) ? videoKeyframeCurvesEqualV2 : videoKeyframeCurvesEqual;
}
export function cloneFrameCommandEffectsV2(project: unknown, effects: unknown,
	options: Readonly<{ regenerateIds?: boolean; idFactory?: () => string }> = {}) {
	if (!current(project)) return cloneVideoEffects(effects, options);
	return normalizeVideoEffectsV2(effects).map(effect => ({ ...effect,
		id: options.regenerateIds ? options.idFactory!() : effect.id,
		params: structuredClone(effect.params),
	}));
}
function current(project: unknown): boolean {
	return Boolean(project && typeof project === 'object' && CURRENT_COMMAND_PROJECTS.has(project));
}
