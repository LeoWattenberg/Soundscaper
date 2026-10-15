/* SPDX-License-Identifier: AGPL-3.0-only */
import { createImageDevelopPresetForProfileV1, normalizeImageDevelopPresetForProfileV1,
	normalizeImageDevelopPresetCurrentForProfileV1 } from './internal/image-develop-preset-kernel-v1.ts';

/** Selected scalar declarations remain inert until native whole-row proof. */
export function createImageDevelopSelectedPresetV4(value: unknown) { return createImageDevelopPresetForProfileV1('current4', value, 'selected'); }
export function normalizeImageDevelopSelectedPresetV4(value: unknown) { return normalizeImageDevelopPresetForProfileV1('current4', value, 'selected'); }
export function normalizeImageDevelopSelectedPresetThroughV4(value: unknown) { return normalizeImageDevelopPresetCurrentForProfileV1('current4', value, 'selected'); }
