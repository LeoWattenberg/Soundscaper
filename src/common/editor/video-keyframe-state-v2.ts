/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoKeyframeStateOwner, type KeyframeState, type KeyframeStateRequest } from './video-keyframe-state-core.ts';
import { normalizeVideoKeyframeCurvesV2, evaluateVideoKeyframeCurvesV2 } from './video-keyframe-curves-v2.ts';
import { normalizeVideoEffectsV2 } from './video-effects-v2.ts';
import type { VideoEffectLeafV2 } from './video-effect-leaf-v2.ts';

export type VideoKeyframedClipStateRequestV2 = KeyframeStateRequest;
export type VideoKeyframedClipStateV2 = KeyframeState<Readonly<VideoEffectLeafV2>>;

const OWNER = createVideoKeyframeStateOwner({ normalizeEffects: normalizeVideoEffectsV2,
	normalizeCurves: normalizeVideoKeyframeCurvesV2, evaluateCurves: evaluateVideoKeyframeCurvesV2 });
export const compileVideoKeyframedClipStateV2 = OWNER.compile;
export const evaluateVideoKeyframedClipStateV2 = OWNER.evaluate;
