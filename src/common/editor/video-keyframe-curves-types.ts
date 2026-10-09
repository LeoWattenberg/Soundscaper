/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CompiledInterpolationCurve } from './interpolation-curve.ts';
import type { RationalInput } from './timeline-time.ts';
import { VIDEO_CLIP_COMPOSITION_NUMERIC_PARAMETER_DESCRIPTORS, type VideoClipCompositionNumericParameterId } from './video-clip-composition.ts';
import type { VideoKeyframeTimeDomain } from './video-keyframe-time-domain.ts';

export const VIDEO_KEYFRAME_CURVES_SCHEMA_VERSION = 1 as const;
export const MAXIMUM_VIDEO_KEYFRAME_CURVES = 256;
export const MAXIMUM_VIDEO_KEYFRAME_ANCHORS = 4_096;
export const VIDEO_KEYFRAME_MINIMUM_APERTURE = 1e-9;
export const VIDEO_KEYFRAME_COMPOSITION_PARAMETER_IDS = Object.freeze(
	Object.keys(VIDEO_CLIP_COMPOSITION_NUMERIC_PARAMETER_DESCRIPTORS),
) as readonly VideoClipCompositionNumericParameterId[];

export type VideoKeyframeCompositionParameterId = VideoClipCompositionNumericParameterId;
export type VideoKeyframeTarget = Readonly<
	| { kind: 'composition'; parameterId: VideoKeyframeCompositionParameterId }
	| { kind: 'video-effect'; effectId: string; parameterId: string }
>;
export interface VideoKeyframeCurve {
	readonly target: VideoKeyframeTarget;
	readonly curve: CompiledInterpolationCurve;
}
export interface VideoKeyframeCurves {
	readonly schemaVersion: typeof VIDEO_KEYFRAME_CURVES_SCHEMA_VERSION;
	readonly timeDomain: VideoKeyframeTimeDomain;
	readonly curves: readonly VideoKeyframeCurve[];
}
export interface VideoKeyframeNormalizationOptions {
	readonly duration: RationalInput;
	readonly composition: unknown;
	readonly videoEffects: unknown;
}
export interface EvaluatedVideoKeyframeValue {
	readonly target: VideoKeyframeTarget;
	readonly value: number;
}
export interface SplitVideoKeyframeCurves {
	readonly left: VideoKeyframeCurves;
	readonly right: VideoKeyframeCurves;
}
