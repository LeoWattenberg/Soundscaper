/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoKeyframeCurveOwner } from './video-keyframe-curves-core.ts';
import { normalizeContextVideoEffects } from './video-keyframe-effect-context.ts';
import { videoEffectDefinition } from './video-effects.js';
export * from './video-keyframe-curves-types.ts';

const OWNER = createVideoKeyframeCurveOwner({ normalizeEffects: normalizeContextVideoEffects, definition: videoEffectDefinition });

export const createDefaultVideoKeyframeCurves = OWNER.createDefaultVideoKeyframeCurves;
export const cloneVideoKeyframeCurves = OWNER.cloneVideoKeyframeCurves;
export const isDefaultVideoKeyframeCurves = OWNER.isDefaultVideoKeyframeCurves;
export const videoKeyframeCurvesEqual = OWNER.videoKeyframeCurvesEqual;
export const trimVideoKeyframeCurvesToRange = OWNER.trimVideoKeyframeCurvesToRange;
export const splitVideoKeyframeCurvesAt = OWNER.splitVideoKeyframeCurvesAt;
export const stretchVideoKeyframeCurves = OWNER.stretchVideoKeyframeCurves;
export const joinVideoKeyframeCurves = OWNER.joinVideoKeyframeCurves;
export const normalizeVideoKeyframeCurves = OWNER.normalizeVideoKeyframeCurves;
export const evaluateVideoKeyframeCurves = OWNER.evaluateVideoKeyframeCurves;
