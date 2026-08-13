/* SPDX-License-Identifier: AGPL-3.0-only */

import { VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION } from './video-preview-render-size.js';

const RGBA_BYTES_PER_PIXEL = 4n;

export const VIDEO_KEYFRAME_OFFLINE_MAXIMUM_WIDTH = 1_280;
export const VIDEO_KEYFRAME_OFFLINE_MAXIMUM_HEIGHT = 720;
export const VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RGBA_BYTES =
	VIDEO_KEYFRAME_OFFLINE_MAXIMUM_WIDTH * VIDEO_KEYFRAME_OFFLINE_MAXIMUM_HEIGHT * 4;

export interface VideoKeyframeOfflineRgbaPlan {
	readonly width: number;
	readonly height: number;
	readonly byteLength: number;
}

/** Bound one physical RGBA canvas before WebGL, decoder, or output allocation. */
export function planVideoKeyframeOfflineRgba(
	canvas: Readonly<{ readonly width: unknown; readonly height: unknown }>,
): VideoKeyframeOfflineRgbaPlan {
	const width = dimension(canvas?.width, 'width', VIDEO_KEYFRAME_OFFLINE_MAXIMUM_WIDTH);
	const height = dimension(canvas?.height, 'height', VIDEO_KEYFRAME_OFFLINE_MAXIMUM_HEIGHT);
	const bytes = BigInt(width) * BigInt(height) * RGBA_BYTES_PER_PIXEL;
	if (bytes > BigInt(VIDEO_KEYFRAME_OFFLINE_MAXIMUM_RGBA_BYTES)) {
		throw new RangeError('Offline video RGBA useful-binary bytes exceed the hard limit.');
	}
	return Object.freeze({ width, height, byteLength: Number(bytes) });
}

function dimension(value: unknown, name: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > maximum
		|| Number(value) > VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION) {
		throw new RangeError(`Offline video output ${name} exceeds its hard limit.`);
	}
	return Number(value);
}
