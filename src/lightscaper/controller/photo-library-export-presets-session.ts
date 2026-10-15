/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoLibraryExportPresetsAccessV1 } from '../../common/editor/photo-library-export-presets-port-v1.ts';
import { openPhotoLibraryExportPresetsForProfileV1, type PhotoLibraryExportPresetsSessionHostV1 } from './internal/photo-library-export-presets-session-kernel-v1.ts';

/** Permanent wire1 facade keeps strict unversioned byte output admission. */
export function openPhotoLibraryExportPresetsSession(host: PhotoLibraryExportPresetsSessionHostV1, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<Readonly<PhotoLibraryExportPresetsAccessV1>> {
	return openPhotoLibraryExportPresetsForProfileV1('legacy1', host, options);
}
