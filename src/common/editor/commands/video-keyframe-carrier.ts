/* SPDX-License-Identifier: AGPL-3.0-only */

import * as curves from '../video-keyframe-curves.ts';
import { createVideoKeyframeCarrierOwner } from './video-keyframe-carrier-core.ts';
const OWNER = createVideoKeyframeCarrierOwner(curves);

export const cloneVideoKeyframeCarrierFields = OWNER.cloneVideoKeyframeCarrierFields;
export const detachVideoKeyframeCarrier = OWNER.detachVideoKeyframeCarrier;
export const trimVideoKeyframeCarrierToSequenceRange = OWNER.trimVideoKeyframeCarrierToSequenceRange;
export const trimVideoKeyframeCarrierToDestination = OWNER.trimVideoKeyframeCarrierToDestination;
export const splitVideoKeyframeCarrierFields = OWNER.splitVideoKeyframeCarrierFields;
export const transformVideoKeyframeCarrier = OWNER.transformVideoKeyframeCarrier;
export const transformVideoKeyframeCarrierFromSourceBounds = OWNER.transformVideoKeyframeCarrierFromSourceBounds;
export const rebindVideoKeyframeCarrierEffects = OWNER.rebindVideoKeyframeCarrierEffects;
export const joinVideoKeyframeCarrierFields = OWNER.joinVideoKeyframeCarrierFields;
export const joinVideoKeyframeCarrierSequenceFields = OWNER.joinVideoKeyframeCarrierSequenceFields;
export const videoKeyframeCarriersJoinable = OWNER.videoKeyframeCarriersJoinable;
export const videoKeyframeSequencePositionAtTimelineFrame = OWNER.videoKeyframeSequencePositionAtTimelineFrame;
