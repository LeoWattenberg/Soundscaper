/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV1, PhotoLibraryDevelopPresetSnapshotV1 } from './photo-library-develop-presets-port-v1.ts';
import type { PhotoLibraryImportRequestOptionsV1 } from './photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryImportItemV1 } from './photo-library-session-port-v1.ts';

/** Capture one saved recipe before preparation; the gesture carries scalar identity only. */
export interface PhotoLibraryDevelopImportRequestV1 extends PhotoLibraryImportRequestOptionsV1 {
	readonly schemaVersion: 1;
	readonly developPreset: PhotoLibraryDevelopPresetReadV1;
}
export type PhotoLibraryImportGestureOptionsV2 = Pick<PhotoLibraryImportRequestOptionsV1, 'settings' | 'signal'>
	& Readonly<{ developPreset?: PhotoLibraryDevelopPresetReadV1 }>;
export interface PhotoLibraryDevelopImportPortV1 {
	listPresets(options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetSnapshotV1>;
	importFiles(files: readonly File[], request: PhotoLibraryDevelopImportRequestV1): Promise<readonly PhotoLibraryImportItemV1[]>;
}
