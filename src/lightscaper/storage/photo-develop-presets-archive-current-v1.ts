/* SPDX-License-Identifier: AGPL-3.0-only */

import { capturePhotoDevelopPresetsArchiveForProfileV1, type PhotoDevelopPresetArchiveSettingsPortV1,
	type PhotoDevelopPresetArchiveCaptureForProfileV1 } from './internal/photo-develop-presets-archive-kernel-v1.ts';
export type PhotoDevelopPresetArchiveCaptureCurrentV1 = PhotoDevelopPresetArchiveCaptureForProfileV1<'current4'>;

/** The same native key, actual presence and complete canonical row digest. */
export function capturePhotoDevelopPresetsArchiveCurrentV1(repository: PhotoDevelopPresetArchiveSettingsPortV1,
	catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoDevelopPresetArchiveCaptureCurrentV1> {
	return capturePhotoDevelopPresetsArchiveForProfileV1('current4', repository, catalogId, options);
}
