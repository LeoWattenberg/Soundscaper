/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportPresetCurrentV1, PhotoExportPresetCommandCurrentV1 } from '../../common/editor/photo-library-export-presets-port-current-v1.ts';
import { normalizePhotoRasterExportPresetForProfileV1, normalizePhotoExportPresetCommandForProfileV1 } from './internal/photo-raster-export-preset-kernel-v1.ts';

export function normalizePhotoRasterExportPresetCurrentV1(value: unknown): Readonly<PhotoRasterExportPresetCurrentV1> {
	return normalizePhotoRasterExportPresetForProfileV1('current1', value);
}
export function normalizePhotoExportPresetCommandCurrentV1(value: unknown): PhotoExportPresetCommandCurrentV1 {
	return normalizePhotoExportPresetCommandForProfileV1('current1', value);
}
