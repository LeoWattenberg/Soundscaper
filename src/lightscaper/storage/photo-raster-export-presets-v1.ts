/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoExportPresetSnapshotV1, PhotoRasterExportPresetV1 } from '../../common/editor/photo-library-export-presets-port-v1.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from './photo-develop-presets-v1.ts';
import { normalizePhotoExportPresetRowForProfileV1, readPhotoExportPresetsForProfileV1, readPhotoExportPresetForProfileV1, writePhotoExportPresetForProfileV1 } from './internal/photo-raster-export-presets-kernel-v1.ts';
export { PhotoExportPresetConflictError, photoExportPresetsKeyV1 } from './internal/photo-raster-export-presets-kernel-v1.ts';
export interface PhotoExportPresetRowV1 {
	readonly schemaVersion: 1; readonly kind: 'photo-export-presets'; readonly catalogId: string;
	readonly revision: number; readonly presets: readonly Readonly<PhotoRasterExportPresetV1>[];
}
export function normalizePhotoExportPresetRowV1(value: unknown, catalogId: string): Readonly<PhotoExportPresetRowV1> {
	return normalizePhotoExportPresetRowForProfileV1('legacy1', value, catalogId);
}
export function readPhotoExportPresetsV1(repository: PhotoDevelopPresetSettingsPortV1, catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoExportPresetSnapshotV1> {
	return readPhotoExportPresetsForProfileV1('legacy1', repository, catalogId, options);
}
export function readPhotoExportPresetV1(repository: PhotoDevelopPresetSettingsPortV1, catalogId: string, presetId: string, revision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<{ preset: PhotoRasterExportPresetV1 }>> {
	return readPhotoExportPresetForProfileV1('legacy1', repository, catalogId, presetId, revision, options);
}
export function writePhotoExportPresetV1(repository: PhotoDevelopPresetSettingsPortV1, catalogId: string, value: unknown, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoExportPresetSnapshotV1> {
	return writePhotoExportPresetForProfileV1('legacy1', repository, catalogId, value, options);
}
