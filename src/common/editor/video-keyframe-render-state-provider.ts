/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoKeyframeRenderStateProviderCore, type VideoKeyframeRenderStateCore, type VideoKeyframeRenderStateProviderCore } from './video-keyframe-render-state-provider-core.ts';
import { compileVideoKeyframedClipState, evaluateVideoKeyframedClipState, type VideoKeyframedClipState } from './video-keyframe-state.ts';
export type { VideoKeyframeRenderStateRequest, VideoKeyframeRenderTransitionWeights } from './video-keyframe-render-state-provider-core.ts';
export type VideoKeyframeRenderState = VideoKeyframeRenderStateCore<VideoKeyframedClipState['videoEffects'][number]>;
export type VideoKeyframeRenderStateProvider = VideoKeyframeRenderStateProviderCore<VideoKeyframedClipState['videoEffects'][number]>;

export function createVideoKeyframeRenderStateProvider(): VideoKeyframeRenderStateProvider {
 return createVideoKeyframeRenderStateProviderCore({ compile: compileVideoKeyframedClipState, evaluate: evaluateVideoKeyframedClipState });
}
