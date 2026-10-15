/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDevelopPresetRowV1 } from './photo-develop-presets-v1.ts';
import type { PhotoDevelopPresetRowV2 } from './photo-develop-preset-row-v2.ts';
import type { PhotoDevelopPresetRowV3 } from './photo-develop-preset-row-v3.ts';
import type { PhotoDevelopPresetRowV4 } from './photo-develop-preset-row-v4.ts';
import { normalizePhotoDevelopPresetRowCurrentForProfileV1 } from './internal/photo-develop-preset-row-kernel-v1.ts';

export type PhotoDevelopPresetRowThroughV3 = PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2 | PhotoDevelopPresetRowV3;
export type PhotoDevelopPresetRowCurrentV1 = PhotoDevelopPresetRowThroughV3 | PhotoDevelopPresetRowV4;
/** No read-time promotion; the native write owner explicitly keeps Row3 sticky. */
export function normalizePhotoDevelopPresetRowCurrentV1(value: unknown, catalogId: string): PhotoDevelopPresetRowCurrentV1 {
	return normalizePhotoDevelopPresetRowCurrentForProfileV1('current4', value, catalogId);
}
