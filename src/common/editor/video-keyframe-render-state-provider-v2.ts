/* SPDX-License-Identifier: AGPL-3.0-only */

import { createVideoKeyframeRenderStateProviderCore, type VideoKeyframeRenderStateCore, type VideoKeyframeRenderStateProviderCore } from './video-keyframe-render-state-provider-core.ts';
import { compileVideoKeyframedClipStateV2, evaluateVideoKeyframedClipStateV2, type VideoKeyframedClipStateV2 } from './video-keyframe-state-v2.ts';
export type { VideoKeyframeRenderStateRequest, VideoKeyframeRenderTransitionWeights } from './video-keyframe-render-state-provider-core.ts';
export type VideoKeyframeRenderStateV2 = VideoKeyframeRenderStateCore<VideoKeyframedClipStateV2['videoEffects'][number]>;
export type VideoKeyframeRenderStateProviderV2 = VideoKeyframeRenderStateProviderCore<VideoKeyframedClipStateV2['videoEffects'][number]>;
const PROVIDERS = new WeakSet<object>();

export function createVideoKeyframeRenderStateProviderV2(): VideoKeyframeRenderStateProviderV2 {
	const provider = createVideoKeyframeRenderStateProviderCore({ compile: compileVideoKeyframedClipStateV2, evaluate: evaluateVideoKeyframedClipStateV2 });
	PROVIDERS.add(provider); return provider;
}
export function isVideoKeyframeRenderStateProviderV2(value: unknown): value is VideoKeyframeRenderStateProviderV2 {
	return value !== null && typeof value === 'object' && PROVIDERS.has(value);
}
