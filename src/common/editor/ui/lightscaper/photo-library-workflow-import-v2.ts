/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV2 } from '../../photo-library-develop-presets-port-v2.ts';
import type { PhotoLibraryImportSettingsV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoLibrarySessionPortV2 } from '../../photo-library-session-port-v2.ts';
import { detachPhotoLibraryImportGestureForProfileV1, executePhotoLibraryImportGestureForProfileV1,
	detachPhotoLibraryImportDevelopPresetForProfileV1 } from './internal/photo-library-workflow-import-kernel-v1.ts';

export interface PhotoLibraryImportGestureOptionsV2 {
	readonly signal?: AbortSignal;
	readonly settings?: PhotoLibraryImportSettingsV1;
	readonly developPreset?: PhotoLibraryDevelopPresetReadV2;
}
export function detachPhotoLibraryImportGestureV2(files: unknown, options: unknown = {}, captureSignal?: (signal: AbortSignal | undefined) => void) {
	return detachPhotoLibraryImportGestureForProfileV1('legacy2', files, options, captureSignal);
}
export function executePhotoLibraryImportGestureV2(owner: Pick<PhotoLibrarySessionPortV2, 'importFiles' | 'developImport'>,
	draft: ReturnType<typeof detachPhotoLibraryImportGestureV2>, signal: AbortSignal, publish: () => void): Promise<void> {
	return executePhotoLibraryImportGestureForProfileV1('legacy2', owner, draft, signal, publish);
}
export function detachPhotoLibraryImportDevelopPresetV2(value: unknown): PhotoLibraryDevelopPresetReadV2 {
	return detachPhotoLibraryImportDevelopPresetForProfileV1('legacy2', value);
}
