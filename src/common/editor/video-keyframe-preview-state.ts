/* SPDX-License-Identifier: AGPL-3.0-only */
import type { VideoKeyframeRenderState, VideoKeyframeRenderStateProvider } from './video-keyframe-render-state-provider.ts';
import { resolveVideoKeyframePreviewStateCore, type VideoKeyframePreviewStateRequest } from './video-keyframe-preview-state-core.ts';
export type { VideoKeyframePreviewStateRequest } from './video-keyframe-preview-state-core.ts';
export { isVideoKeyframePreviewStateError, isVideoKeyframePreviewFailureCurrent, videoKeyframeLocalSequencePositionAtTimelineSample } from './video-keyframe-preview-state-core.ts';

/** The original provider remains bound to strict V1 keyframe/effect owners. */
export function resolveVideoKeyframePreviewState(provider: VideoKeyframeRenderStateProvider | null | undefined,
	request: VideoKeyframePreviewStateRequest): VideoKeyframeRenderState | null {
	return resolveVideoKeyframePreviewStateCore(provider, request);
}
