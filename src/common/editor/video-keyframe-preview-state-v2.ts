/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveVideoKeyframePreviewStateCore, type VideoKeyframePreviewStateRequest } from './video-keyframe-preview-state-core.ts';
import { resolveVideoKeyframePreviewState } from './video-keyframe-preview-state.ts';
import type { VideoKeyframeRenderStateProvider } from './video-keyframe-render-state-provider.ts';
import { isVideoKeyframeRenderStateProviderV2, type VideoKeyframeRenderStateProviderV2 } from './video-keyframe-render-state-provider-v2.ts';

export function resolveVideoKeyframePreviewStateV2(provider: VideoKeyframeRenderStateProviderV2 | null | undefined,
	request: VideoKeyframePreviewStateRequest) {
	return resolveVideoKeyframePreviewStateCore(provider, request);
}

/** A privately created current provider is the only new admission route. */
export function resolveVideoKeyframePreviewStateCurrent(provider: VideoKeyframeRenderStateProvider | VideoKeyframeRenderStateProviderV2 | null | undefined,
	request: VideoKeyframePreviewStateRequest) {
	return isVideoKeyframeRenderStateProviderV2(provider)
		? resolveVideoKeyframePreviewStateV2(provider, request) : resolveVideoKeyframePreviewState(provider, request);
}
