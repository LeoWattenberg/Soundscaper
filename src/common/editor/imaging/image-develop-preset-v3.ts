/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoVisualPresetV1 } from '../video-visual-preset-v24.ts';
import type { ImageDevelopSettingsPacketV3 } from './image-develop-settings-contract-v3.ts';
import { createImageDevelopPresetForProfileV1, normalizeImageDevelopPresetForProfileV1,
	applyImageDevelopPresetForProfileV1, readImageDevelopPresetJsonV1 } from './internal/image-develop-preset-kernel-v1.ts';

export interface ImageDevelopPresetV3 {
	readonly schemaVersion: 3;
	readonly kind: 'image-develop-preset';
	readonly identity: Readonly<VideoVisualPresetV1>;
	readonly settings: Readonly<ImageDevelopSettingsPacketV3>;
}

/** Explicit Current metadata; external JSON remains mask-resource strict. */
export function createImageDevelopPresetV3(value: unknown) { return createImageDevelopPresetForProfileV1('current3', value); }
export function normalizeImageDevelopPresetV3(value: unknown) { return normalizeImageDevelopPresetForProfileV1('current3', value); }
export function applyImageDevelopPresetV3(value: unknown) { return applyImageDevelopPresetForProfileV1('current3', value); }
export function serializeImageDevelopPresetV3(value: unknown): string { return JSON.stringify(normalizeImageDevelopPresetV3(value)); }
export function parseImageDevelopPresetV3(value: unknown) { return normalizeImageDevelopPresetV3(readImageDevelopPresetJsonV1(value)); }
