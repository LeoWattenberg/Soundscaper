/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoVisualPresetV1 } from '../video-visual-preset-v24.ts';
import type { ImageDevelopSettingsPacketV2 } from './image-develop-settings-contract-v2.ts';
import { createImageDevelopPresetForProfileV1, normalizeImageDevelopPresetForProfileV1,
	normalizeImageDevelopPresetCurrentForProfileV1, applyImageDevelopPresetForProfileV1,
	readImageDevelopPresetJsonV1 } from './internal/image-develop-preset-kernel-v1.ts';

/** Permanent strict2 body; the unchanged scalar identity binds exact Packet2. */
export interface ImageDevelopPresetV2 {
	readonly schemaVersion: 2;
	readonly kind: 'image-develop-preset';
	readonly identity: Readonly<VideoVisualPresetV1>;
	readonly settings: Readonly<ImageDevelopSettingsPacketV2>;
}
export function createImageDevelopPresetV2(value: unknown) { return createImageDevelopPresetForProfileV1('legacy2', value); }
export function normalizeImageDevelopPresetV2(value: unknown) { return normalizeImageDevelopPresetForProfileV1('legacy2', value); }
export function normalizeImageDevelopPresetV1OrV2(value: unknown) { return normalizeImageDevelopPresetCurrentForProfileV1('legacy2', value); }
export function applyImageDevelopPresetV2(value: unknown) { return applyImageDevelopPresetForProfileV1('legacy2', value); }
export function serializeImageDevelopPresetV2(value: unknown): string { return JSON.stringify(normalizeImageDevelopPresetV2(value)); }
export function serializeImageDevelopPresetV1OrV2(value: unknown): string { return JSON.stringify(normalizeImageDevelopPresetV1OrV2(value)); }
export function parseImageDevelopPresetV2(value: unknown) { return normalizeImageDevelopPresetV2(readImageDevelopPresetJsonV1(value)); }
export function parseImageDevelopPresetV1OrV2(value: unknown) { return normalizeImageDevelopPresetV1OrV2(readImageDevelopPresetJsonV1(value)); }
