/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord, readClosedDomainField as field } from './closed-domain-value.ts';
import { normalizeVideoClipComposition, type VideoClipComposition } from './video-clip-composition.ts';
import { normalizeVideoEffectsV2 } from './video-effects-v2.ts';
import { normalizeVideoKeyframeCurvesV2 } from './video-keyframe-curves-v2.ts';
import type { VideoKeyframeCurves } from './video-keyframe-curves-types.ts';
import type { VideoEffectLeafV2 } from './video-effect-leaf-v2.ts';
import { normalizeUnifiedExactRenderClipNodeCore } from './unified-exact-render-clip-node-core.ts';
import type { UnifiedExactRenderClipNode, UnifiedExactRenderTemporalContext, UnifiedExactRenderSourceIndex,
	UnifiedExactRenderTrackIndexV1 } from './unified-exact-render-plan-v9.ts';
import type { UnifiedExactRenderTimingIndex } from './unified-exact-render-timing-authority.ts';

export interface UnifiedExactRenderClipPictureStateV2 {
	readonly composition: VideoClipComposition;
	readonly videoEffects: readonly Readonly<VideoEffectLeafV2>[];
	readonly videoKeyframes: VideoKeyframeCurves;
}
export type UnifiedExactRenderClipNodeV2 = Omit<UnifiedExactRenderClipNode, 'pictureState'>
	& Readonly<{ pictureState: UnifiedExactRenderClipPictureStateV2 }>;

export function normalizeUnifiedExactRenderClipNodeV2(value: unknown, context: UnifiedExactRenderTemporalContext,
	sources: UnifiedExactRenderSourceIndex, tracks: UnifiedExactRenderTrackIndexV1,
	timing: UnifiedExactRenderTimingIndex): UnifiedExactRenderClipNodeV2 {
	return normalizeUnifiedExactRenderClipNodeCore(normalizePictureState, value, context, sources, tracks, timing);
}

function normalizePictureState(value: unknown, sequenceFrameCount: number, clipId: string): UnifiedExactRenderClipPictureStateV2 {
	const name = `unified clip ${clipId} picture state`;
	const state = readClosedDomainRecord(value, name, ['composition', 'videoEffects', 'videoKeyframes']);
	const composition = normalizeVideoClipComposition(field(state, 'composition', name), `${name}.composition`);
	const videoEffects = normalizeVideoEffectsV2(field(state, 'videoEffects', name), `${name}.videoEffects`);
	const videoKeyframes = normalizeVideoKeyframeCurvesV2(field(state, 'videoKeyframes', name),
		{ duration: { num: sequenceFrameCount, den: 1 }, composition, videoEffects }, `${name}.videoKeyframes`);
	return Object.freeze({ composition, videoEffects, videoKeyframes });
}
