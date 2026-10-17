/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportPresetV1, PhotoExportPresetCommandV1 } from '../../common/editor/photo-library-export-presets-port-v1.ts';
import { normalizePhotoRasterExportPresetForProfileV1, normalizePhotoExportPresetCommandForProfileV1 } from './internal/photo-raster-export-preset-kernel-v1.ts';
export { PHOTO_EXPORT_PRESETS_LIMITS_V1, checkPhotoExportPresetBytesV1 } from './internal/photo-raster-export-preset-kernel-v1.ts';

export function normalizePhotoRasterExportPresetV1(value: unknown): Readonly<PhotoRasterExportPresetV1> {
	return normalizePhotoRasterExportPresetForProfileV1('legacy1', value);
}
export function normalizePhotoExportPresetCommandV1(value: unknown): PhotoExportPresetCommandV1 {
	return normalizePhotoExportPresetCommandForProfileV1('legacy1', value);
}
