/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopPresetV1 } from './image-develop-preset-v1.ts';
import type { ImageDevelopPresetV2 } from './image-develop-preset-v2.ts';
import type { ImageDevelopPresetV3 } from './image-develop-preset-v3.ts';
import type { ImageDevelopPresetV4 } from './image-develop-preset-v4.ts';
import { field, record } from './image-develop-value.ts';
import { normalizeImageDevelopPresetCurrentForProfileV1, applyImageDevelopPresetForProfileV1,
	readImageDevelopPresetJsonV1 } from './internal/image-develop-preset-kernel-v1.ts';

export type ImageDevelopPresetThroughV3 = ImageDevelopPresetV1 | ImageDevelopPresetV2 | ImageDevelopPresetV3;
export type ImageDevelopPresetCurrentV1 = ImageDevelopPresetThroughV3 | ImageDevelopPresetV4;
export function normalizeImageDevelopPresetCurrentV1(value: unknown): ImageDevelopPresetCurrentV1 {
	return normalizeImageDevelopPresetCurrentForProfileV1('current4', value);
}
export function applyImageDevelopPresetCurrentV1(value: unknown) {
	const input = record(value, 'Current preset application', ['schemaVersion', 'target', 'preset']);
	const version = field(input, 'schemaVersion');
	if (version !== 3 && version !== 4) throw new RangeError('Unsupported Current preset application version.');
	return applyImageDevelopPresetForProfileV1('current4', { ...input, schemaVersion: 4 });
}
export function serializeImageDevelopPresetCurrentV1(value: unknown): string { return JSON.stringify(normalizeImageDevelopPresetCurrentV1(value)); }
export function parseImageDevelopPresetCurrentV1(value: unknown): ImageDevelopPresetCurrentV1 {
	return normalizeImageDevelopPresetCurrentV1(readImageDevelopPresetJsonV1(value));
}
