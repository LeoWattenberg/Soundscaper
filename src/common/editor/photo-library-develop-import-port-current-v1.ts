/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV3, PhotoLibraryDevelopPresetSnapshotV3 } from './photo-library-develop-presets-port-v3.ts';
import type { PhotoLibraryImportRequestOptionsV1 } from './photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryImportItemV1 } from './photo-library-session-port-v1.ts';

export interface PhotoLibraryDevelopImportRequestCurrentV1 extends PhotoLibraryImportRequestOptionsV1 {
	readonly schemaVersion: 3;
	readonly developPreset: PhotoLibraryDevelopPresetReadV3;
}

/** Selected Current preset identity; JSON never grants brush-body authority. */
export interface PhotoLibraryDevelopImportPortCurrentV1 {
	readonly schemaVersion: 3;
	listPresets(options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetSnapshotV3>;
	importFiles(files: readonly File[], request: PhotoLibraryDevelopImportRequestCurrentV1): Promise<readonly PhotoLibraryImportItemV1[]>;
}
