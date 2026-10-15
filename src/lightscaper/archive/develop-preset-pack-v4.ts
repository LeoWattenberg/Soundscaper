/* SPDX-License-Identifier: AGPL-3.0-only */
import { PHOTO_DEVELOP_PRESET_PACK_LIMITS, encodePhotoDevelopPresetPackForProfile, readPhotoDevelopPresetPackForProfile } from './develop-preset-pack-kernel.ts';
export const PHOTO_DEVELOP_PRESET_PACK_LIMITS_V4 = PHOTO_DEVELOP_PRESET_PACK_LIMITS;
export function encodePhotoDevelopPresetPackV4(value: unknown, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): AsyncIterable<Uint8Array> {
	return encodePhotoDevelopPresetPackForProfile('current4', value, catalogId, options);
}
export function readPhotoDevelopPresetPackV4(source: AsyncIterable<Uint8Array>, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return readPhotoDevelopPresetPackForProfile('current4', source, catalogId, options);
}
