/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PixelFrameLimitsV1 } from './pixel-frame-contract-v1.ts';
import { encodePixelFramePngStreamV1, PIXEL_FRAME_PNG_STREAM_MAXIMUM_OUTPUT_BYTES_V1, PIXEL_FRAME_PNG16_PROFILES_V1 } from './pixel-frame-png-stream-kernel-v1.ts';

export interface PixelFramePng16OptionsV1 {
	readonly signal?: AbortSignal;
	readonly limits?: PixelFrameLimitsV1;
	readonly maximumOutputBytes?: number;
}
export const PIXEL_FRAME_PNG16_MAXIMUM_OUTPUT_BYTES_V1 = PIXEL_FRAME_PNG_STREAM_MAXIMUM_OUTPUT_BYTES_V1;
export { PIXEL_FRAME_PNG16_PROFILES_V1 };

/** Permanent deterministic sRGB RGBA16 policy. Its exact source profiles,
 * options, byte stream and physical retirement remain fixed; Current P3 output
 * is selected only through its separately named profile entry point. */
export function encodePixelFramePng16V1(value: unknown, optionsValue: unknown = {}): Promise<Uint8Array<ArrayBuffer>> {
	return encodePixelFramePngStreamV1('srgb16', value, optionsValue);
}
