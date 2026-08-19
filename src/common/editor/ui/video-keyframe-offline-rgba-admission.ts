/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES } from '../video-keyframe-encoder-admission.ts';
import { VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION } from './video-preview-render-size.js';

const RGBA_BYTES_PER_PIXEL = 4n;

/**
 * One RGBA frame's ceiling, which is the encoder's own 8 MiB stream limit.
 *
 * It used to be 1280x720 per side, which is the automatic canvas rather than a
 * bound on anything: a keyed delivery at the vertical canvas this milestone
 * added was admitted by the plan — the plan's bound is exactly this many bytes —
 * and then refused here, after the report had already been written. Both ends
 * answer to the same number now, and each extent still answers to the render
 * dimension a GL target is allowed.
 */
export const VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RGBA_BYTES = VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES;

export interface VideoKeyframeOfflineRgbaPlan {
	readonly width: number;
	readonly height: number;
	readonly byteLength: number;
}

/** Bound one physical RGBA canvas before WebGL, decoder, or output allocation. */
export function planVideoKeyframeOfflineRgba(
	canvas: Readonly<{ readonly width: unknown; readonly height: unknown }>,
): VideoKeyframeOfflineRgbaPlan {
	const width = dimension(canvas?.width, 'width');
	const height = dimension(canvas?.height, 'height');
	const bytes = BigInt(width) * BigInt(height) * RGBA_BYTES_PER_PIXEL;
	if (bytes > BigInt(VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RGBA_BYTES)) {
		throw new RangeError('Offline video RGBA useful-binary bytes exceed the hard limit.');
	}
	return Object.freeze({ width, height, byteLength: Number(bytes) });
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION) {
		throw new RangeError(`Offline video output ${name} exceeds its hard limit.`);
	}
	return Number(value);
}
