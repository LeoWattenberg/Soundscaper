/* SPDX-License-Identifier: AGPL-3.0-only */
import type { VideoVisualPresetV1 } from '../video-visual-preset-v24.ts';
import type { ImageDevelopSettingsPacketV4 } from './image-develop-settings-contract-v4.ts';
import { createImageDevelopPresetForProfileV1, normalizeImageDevelopPresetForProfileV1,
	applyImageDevelopPresetForProfileV1, readImageDevelopPresetJsonV1 } from './internal/image-develop-preset-kernel-v1.ts';

export interface ImageDevelopPresetV4 {
	readonly schemaVersion: 4;
	readonly kind: 'image-develop-preset';
	readonly identity: Readonly<VideoVisualPresetV1>;
	readonly settings: Readonly<ImageDevelopSettingsPacketV4>;
}
export function createImageDevelopPresetV4(value: unknown) { return createImageDevelopPresetForProfileV1('current4', value); }
export function normalizeImageDevelopPresetV4(value: unknown) { return normalizeImageDevelopPresetForProfileV1('current4', value); }
export function applyImageDevelopPresetV4(value: unknown) { return applyImageDevelopPresetForProfileV1('current4', value); }
export function serializeImageDevelopPresetV4(value: unknown): string { return JSON.stringify(normalizeImageDevelopPresetV4(value)); }
export function parseImageDevelopPresetV4(value: unknown) { return normalizeImageDevelopPresetV4(readImageDevelopPresetJsonV1(value)); }
