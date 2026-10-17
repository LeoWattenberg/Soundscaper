/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	joinVideoKeyframeCurvesV2 as joinVideoKeyframeCurves,
	normalizeVideoKeyframeCurvesV2 as normalizeVideoKeyframeCurves,
	splitVideoKeyframeCurvesAtV2 as splitVideoKeyframeCurvesAt,
	stretchVideoKeyframeCurvesV2 as stretchVideoKeyframeCurves,
	trimVideoKeyframeCurvesToRangeV2 as trimVideoKeyframeCurvesToRange,
} from '../video-keyframe-curves-v2.ts';
import { createVideoKeyframeCarrierOwner } from './video-keyframe-carrier-core.ts';

export const FRAME_VIDEO_KEYFRAME_CARRIERS_V2 = createVideoKeyframeCarrierOwner({ joinVideoKeyframeCurves, normalizeVideoKeyframeCurves, splitVideoKeyframeCurvesAt, stretchVideoKeyframeCurves, trimVideoKeyframeCurvesToRange });
