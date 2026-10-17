/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoDevelopPresetsArchiveForProfileV1, type PhotoDevelopPresetArchiveSettingsPortV1,
	type PhotoDevelopPresetArchiveCaptureForProfileV1 } from './internal/photo-develop-presets-archive-kernel-v1.ts';
export type { PhotoDevelopPresetArchiveSettingsPortV1 } from './internal/photo-develop-presets-archive-kernel-v1.ts';
export type PhotoDevelopPresetArchiveCaptureV2 = PhotoDevelopPresetArchiveCaptureForProfileV1<'legacy2'>;

export function capturePhotoDevelopPresetsArchiveV2(repository: PhotoDevelopPresetArchiveSettingsPortV1,
	catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoDevelopPresetArchiveCaptureV2> {
	return capturePhotoDevelopPresetsArchiveForProfileV1('legacy2', repository, catalogId, options);
}
