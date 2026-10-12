/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopPresetCurrentV1 } from '../../common/editor/imaging/image-develop-preset-current-v1.ts';
import type { PhotoDevelopPresetRowV1 } from './photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowForProfileV1 } from './internal/photo-develop-preset-row-kernel-v1.ts';

/** Same native key and scalar shape; repairs and brush references stay inert.
 * Empty schema3 and all mixed retained preset bodies remain explicit3. */
export interface PhotoDevelopPresetRowV3 extends Omit<PhotoDevelopPresetRowV1, 'schemaVersion' | 'presets'> {
	readonly schemaVersion: 3;
	readonly presets: readonly ImageDevelopPresetCurrentV1[];
}
export function normalizePhotoDevelopPresetRowV3(value: unknown, catalogId: string): PhotoDevelopPresetRowV3 {
	return normalizePhotoDevelopPresetRowForProfileV1('current3', value, catalogId);
}
