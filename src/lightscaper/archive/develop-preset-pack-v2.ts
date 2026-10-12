/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_DEVELOP_PRESET_PACK_LIMITS, encodePhotoDevelopPresetPackForProfile, readPhotoDevelopPresetPackForProfile } from './develop-preset-pack-kernel.ts';
export const PHOTO_DEVELOP_PRESET_PACK_LIMITS_V2 = PHOTO_DEVELOP_PRESET_PACK_LIMITS;
/** Fixed legacy2 metadata admission; referenced bodies remain separately owned. */
export function encodePhotoDevelopPresetPackV2(value: unknown, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): AsyncIterable<Uint8Array> {
	return encodePhotoDevelopPresetPackForProfile('legacy2', value, catalogId, options);
}
export function readPhotoDevelopPresetPackV2(source: AsyncIterable<Uint8Array>, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return readPhotoDevelopPresetPackForProfile('legacy2', source, catalogId, options);
}
