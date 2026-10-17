/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV3 } from '../../photo-library-develop-presets-port-v3.ts';
import type { PhotoLibraryImportSettingsV1 } from '../../photo-library-import-settings-port-v1.ts';
import type { PhotoLibrarySessionPortCurrentV1 } from '../../photo-library-session-port-current-v1.ts';
import { detachPhotoLibraryImportGestureForProfileV1, executePhotoLibraryImportGestureForProfileV1,
	detachPhotoLibraryImportDevelopPresetForProfileV1 } from './internal/photo-library-workflow-import-kernel-v1.ts';

export interface PhotoLibraryImportGestureOptionsCurrentV1 {
	readonly signal?: AbortSignal;
	readonly settings?: PhotoLibraryImportSettingsV1;
	readonly developPreset?: PhotoLibraryDevelopPresetReadV3;
}
/** Explicit Current identity capture; the permanent V2 path remains closed. */
export function detachPhotoLibraryImportGestureCurrentV1(files: unknown, options: unknown = {}, captureSignal?: (signal: AbortSignal | undefined) => void) {
	return detachPhotoLibraryImportGestureForProfileV1('current3', files, options, captureSignal);
}
export function executePhotoLibraryImportGestureCurrentV1(owner: Pick<PhotoLibrarySessionPortCurrentV1, 'importFiles' | 'developImportCurrent'>,
	draft: ReturnType<typeof detachPhotoLibraryImportGestureCurrentV1>, signal: AbortSignal, publish: () => void): Promise<void> {
	return executePhotoLibraryImportGestureForProfileV1('current3', owner, draft, signal, publish);
}
export function detachPhotoLibraryImportDevelopPresetCurrentV1(value: unknown): PhotoLibraryDevelopPresetReadV3 {
	return detachPhotoLibraryImportDevelopPresetForProfileV1('current3', value);
}
