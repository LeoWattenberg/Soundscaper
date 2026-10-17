/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoKeyframeCurveOwner } from './video-keyframe-curves-core.ts';
import { normalizeContextVideoEffectsV2 } from './video-keyframe-effect-context-v2.ts';
import { videoEffectDefinitionV2 } from './video-effects-v2.ts';
export * from './video-keyframe-curves-types.ts';

const OWNER = createVideoKeyframeCurveOwner({ normalizeEffects: normalizeContextVideoEffectsV2, definition: videoEffectDefinitionV2 });

export const createDefaultVideoKeyframeCurvesV2 = OWNER.createDefaultVideoKeyframeCurves;
export const cloneVideoKeyframeCurvesV2 = OWNER.cloneVideoKeyframeCurves;
export const isDefaultVideoKeyframeCurvesV2 = OWNER.isDefaultVideoKeyframeCurves;
export const videoKeyframeCurvesEqualV2 = OWNER.videoKeyframeCurvesEqual;
export const trimVideoKeyframeCurvesToRangeV2 = OWNER.trimVideoKeyframeCurvesToRange;
export const splitVideoKeyframeCurvesAtV2 = OWNER.splitVideoKeyframeCurvesAt;
export const stretchVideoKeyframeCurvesV2 = OWNER.stretchVideoKeyframeCurves;
export const joinVideoKeyframeCurvesV2 = OWNER.joinVideoKeyframeCurves;
export const normalizeVideoKeyframeCurvesV2 = OWNER.normalizeVideoKeyframeCurves;
export const evaluateVideoKeyframeCurvesV2 = OWNER.evaluateVideoKeyframeCurves;
