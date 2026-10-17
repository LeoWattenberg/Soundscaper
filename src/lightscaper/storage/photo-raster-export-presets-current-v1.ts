/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoDevelopPresetSettingsPortV1 } from './photo-develop-presets-v1.ts';
import { normalizePhotoExportPresetRowForProfileV1, readPhotoExportPresetsForProfileV1, readPhotoExportPresetForProfileV1, writePhotoExportPresetForProfileV1 } from './internal/photo-raster-export-presets-kernel-v1.ts';
export type { PhotoExportPresetRowCurrentV1 } from './internal/photo-raster-export-presets-kernel-v1.ts';

export function normalizePhotoExportPresetRowCurrentV1(value: unknown, catalogId: string) { return normalizePhotoExportPresetRowForProfileV1('current1', value, catalogId); }
export function readPhotoExportPresetsCurrentV1(repository: PhotoDevelopPresetSettingsPortV1, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return readPhotoExportPresetsForProfileV1('current1', repository, catalogId, options);
}
export function readPhotoExportPresetCurrentV1(repository: PhotoDevelopPresetSettingsPortV1, catalogId: string, presetId: string, revision: number, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return readPhotoExportPresetForProfileV1('current1', repository, catalogId, presetId, revision, options);
}
export function writePhotoExportPresetCurrentV1(repository: PhotoDevelopPresetSettingsPortV1, catalogId: string, value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return writePhotoExportPresetForProfileV1('current1', repository, catalogId, value, options);
}
