/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoEffectLeaf } from '../project-media-types.ts';
import type { VideoMaskMatteGraphV1 } from '../video-mask-matte-v24.ts';

export const IMAGE_DEVELOP_LIMITS_V1 = Object.freeze({ maximumBytes: 2_097_152, maximumEffects: 256, maximumMasks: 64 });
/** The existing process-1 geometry remains byte-stable beside newer shared geometry effects. */
export interface ImageDevelopGeometryV1 {
	readonly crop: Readonly<{ x: number; y: number; width: number; height: number }> | null;
	readonly rotationDegrees: number;
	readonly flipHorizontal: boolean;
	readonly flipVertical: boolean;
}
export interface ImageDevelopMaskBindingV1 { readonly effectId: string; readonly maskId: string; }
export interface ImageDevelopStateV1 {
	readonly processVersion: 1;
	readonly effects: readonly VideoEffectLeaf[];
	readonly geometry: ImageDevelopGeometryV1;
	readonly masks: readonly VideoMaskMatteGraphV1[];
	readonly maskBindings: readonly ImageDevelopMaskBindingV1[];
}
