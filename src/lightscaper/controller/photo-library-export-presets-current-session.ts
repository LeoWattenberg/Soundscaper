/* SPDX-License-Identifier: AGPL-3.0-only */
import { openPhotoLibraryExportPresetsForProfileV1, type PhotoLibraryExportPresetsSessionHostV1 } from './internal/photo-library-export-presets-session-kernel-v1.ts';

export function openPhotoLibraryExportPresetsCurrentSession(host: PhotoLibraryExportPresetsSessionHostV1, options: Readonly<{ signal?: AbortSignal }> = {}) {
	return openPhotoLibraryExportPresetsForProfileV1('current1', host, options);
}
