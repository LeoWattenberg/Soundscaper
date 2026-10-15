/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ImageDevelopPresetCurrentV1 } from '../../common/editor/imaging/image-develop-preset-current-v1.ts';
import type { PhotoDevelopPresetRowV1 } from './photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowForProfileV1 } from './internal/photo-develop-preset-row-kernel-v1.ts';

export interface PhotoDevelopPresetRowV4 extends Omit<PhotoDevelopPresetRowV1, 'schemaVersion' | 'presets'> {
	readonly schemaVersion: 4;
	readonly presets: readonly ImageDevelopPresetCurrentV1[];
}
export function normalizePhotoDevelopPresetRowV4(value: unknown, catalogId: string): PhotoDevelopPresetRowV4 {
	return normalizePhotoDevelopPresetRowForProfileV1('current4', value, catalogId);
}
