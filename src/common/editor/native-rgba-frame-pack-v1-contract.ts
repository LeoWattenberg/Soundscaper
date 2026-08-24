/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH,
} from './video-keyframe-encoder-admission.ts';

export const NATIVE_RGBA_FRAME_PACK_V1_FILE_HEADER_BYTES = 59;
export const NATIVE_RGBA_FRAME_PACK_V1_FRAME_HEADER_BYTES = 32;
export const NATIVE_RGBA_FRAME_PACK_V1_MAXIMUM_BYTES = 16 * 1024 ** 4;

export interface NativeRgbaFramePackV1Shape {
	readonly width: number;
	readonly height: number;
	readonly frameCount: number;
}

/** Exact stream length is plan-derived before the first evaluated pixel exists. */
export function nativeRgbaFramePackV1ByteLength(value: NativeRgbaFramePackV1Shape): number {
	const width = integer(value?.width, 1, VIDEO_KEYFRAME_ENCODER_MAXIMUM_WIDTH, 'width');
	const height = integer(value?.height, 1, VIDEO_KEYFRAME_ENCODER_MAXIMUM_HEIGHT, 'height');
	const frameCount = integer(
		value?.frameCount, 1, VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_COUNT, 'frame count',
	);
	const frameBytes = BigInt(width) * BigInt(height) * 4n;
	if (frameBytes > BigInt(VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES)) {
		throw new RangeError('The RGBA frame-pack picture exceeds its exact frame-byte domain.');
	}
	const byteLength = BigInt(NATIVE_RGBA_FRAME_PACK_V1_FILE_HEADER_BYTES)
		+ BigInt(frameCount) * (
			BigInt(NATIVE_RGBA_FRAME_PACK_V1_FRAME_HEADER_BYTES) + frameBytes
		);
	if (byteLength > BigInt(NATIVE_RGBA_FRAME_PACK_V1_MAXIMUM_BYTES)
		|| byteLength > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError('The RGBA frame-pack stream exceeds its 16 TiB exact-length domain.');
	}
	return Number(byteLength);
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The RGBA frame-pack ${label} is outside its closed domain.`);
	}
	return Number(value);
}
