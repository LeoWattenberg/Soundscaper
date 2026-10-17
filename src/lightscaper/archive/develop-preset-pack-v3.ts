/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_DEVELOP_PRESET_PACK_LIMITS, encodePhotoDevelopPresetPackForProfile, readPhotoDevelopPresetPackForProfile } from './develop-preset-pack-kernel.ts';
export const PHOTO_DEVELOP_PRESET_PACK_LIMITS_V3 = PHOTO_DEVELOP_PRESET_PACK_LIMITS;
/** Fixed current3 metadata admission; referenced bodies remain separately owned. */
export function encodePhotoDevelopPresetPackV3(value: unknown, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): AsyncIterable<Uint8Array> {
	return encodePhotoDevelopPresetPackForProfile('current3', value, catalogId, options);
}
export function readPhotoDevelopPresetPackV3(source: AsyncIterable<Uint8Array>, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return readPhotoDevelopPresetPackForProfile('current3', source, catalogId, options);
}
