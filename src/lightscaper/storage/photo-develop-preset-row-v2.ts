/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopPresetV2 } from '../../common/editor/imaging/image-develop-preset-v2.ts';
import type { ImageDevelopPresetV1 } from '../../common/editor/imaging/image-develop-preset-v1.ts';
import type { PhotoDevelopPresetRowV1 } from './photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowForProfileV1, normalizePhotoDevelopPresetRowCurrentForProfileV1 } from './internal/photo-develop-preset-row-kernel-v1.ts';

/** Permanent strict mixed1/2 row at the unchanged physical settings key. */
export interface PhotoDevelopPresetRowV2 extends Omit<PhotoDevelopPresetRowV1, 'schemaVersion' | 'presets'> {
	readonly schemaVersion: 2;
	readonly presets: readonly (ImageDevelopPresetV1 | ImageDevelopPresetV2)[];
}
export function normalizePhotoDevelopPresetRowV2(value: unknown, catalogId: string): PhotoDevelopPresetRowV2 {
	return normalizePhotoDevelopPresetRowForProfileV1('legacy2', value, catalogId);
}
export function normalizePhotoDevelopPresetRowV1OrV2(value: unknown, catalogId: string): PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2 {
	return normalizePhotoDevelopPresetRowCurrentForProfileV1('legacy2', value, catalogId);
}
