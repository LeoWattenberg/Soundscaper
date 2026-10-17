/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoKeyframeStateOwner } from './video-keyframe-state-core.ts';
import { normalizeVideoKeyframeCurves, evaluateVideoKeyframeCurves } from './video-keyframe-curves.ts';
import { normalizeVideoEffects } from './video-effects.js';
import type { VideoClipComposition } from './video-clip-composition.ts';
import type { RationalInput } from './timeline-time.ts';

export interface VideoKeyframedClipStateRequest {
	readonly videoKeyframes: unknown;
	readonly sequenceFrameCount: RationalInput;
	readonly composition: unknown;
	readonly videoEffects: unknown;
}

export interface VideoKeyframedClipState {
	readonly composition: VideoClipComposition;
	readonly videoEffects: readonly Readonly<{
		readonly id: string;
		readonly type: string;
		readonly enabled: boolean;
		readonly params: Readonly<Record<string, number>>;
	}>[];
}

const OWNER = createVideoKeyframeStateOwner({
 normalizeEffects: (value: unknown, name: string) => freezeVideoEffects(normalizeVideoEffects(value, name)),
 normalizeCurves: normalizeVideoKeyframeCurves, evaluateCurves: evaluateVideoKeyframeCurves,
});
export const compileVideoKeyframedClipState = OWNER.compile;
export const evaluateVideoKeyframedClipState = OWNER.evaluate;

function freezeVideoEffects(
	effects: readonly Readonly<Record<string, unknown>>[],
): VideoKeyframedClipState['videoEffects'] {
	return Object.freeze(effects.map((effect) => Object.freeze({
		id: String(effect.id),
		type: String(effect.type),
		enabled: effect.enabled === true,
		params: Object.freeze({ ...(effect.params as Readonly<Record<string, number>>) }),
	})));
}
