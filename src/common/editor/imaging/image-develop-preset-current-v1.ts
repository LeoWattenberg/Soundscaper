/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopPresetV1 } from './image-develop-preset-v1.ts';
import type { ImageDevelopPresetV2 } from './image-develop-preset-v2.ts';
import type { ImageDevelopPresetV3 } from './image-develop-preset-v3.ts';
import { normalizeImageDevelopPresetCurrentForProfileV1, applyImageDevelopPresetForProfileV1,
	readImageDevelopPresetJsonV1 } from './internal/image-develop-preset-kernel-v1.ts';

export type ImageDevelopPresetCurrentV1 = ImageDevelopPresetV1 | ImageDevelopPresetV2 | ImageDevelopPresetV3;
export function normalizeImageDevelopPresetCurrentV1(value: unknown): ImageDevelopPresetCurrentV1 {
	return normalizeImageDevelopPresetCurrentForProfileV1('current3', value);
}
export function applyImageDevelopPresetCurrentV1(value: unknown) { return applyImageDevelopPresetForProfileV1('current3', value); }
export function serializeImageDevelopPresetCurrentV1(value: unknown): string { return JSON.stringify(normalizeImageDevelopPresetCurrentV1(value)); }
export function parseImageDevelopPresetCurrentV1(value: unknown): ImageDevelopPresetCurrentV1 {
	return normalizeImageDevelopPresetCurrentV1(readImageDevelopPresetJsonV1(value));
}
