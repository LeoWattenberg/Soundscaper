/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPresetReadV2, PhotoLibraryDevelopPresetSnapshotV2 } from './photo-library-develop-presets-port-v2.ts';
import type { PhotoLibraryImportRequestOptionsV1 } from './photo-library-import-settings-port-v1.ts';
import type { PhotoLibraryImportItemV1 } from './photo-library-session-port-v1.ts';

export interface PhotoLibraryDevelopImportRequestV2 extends PhotoLibraryImportRequestOptionsV1 {
	readonly schemaVersion: 2;
	readonly developPreset: PhotoLibraryDevelopPresetReadV2;
}
export interface PhotoLibraryDevelopImportPortV2 {
	readonly schemaVersion: 2;
	listPresets(options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryDevelopPresetSnapshotV2>;
	importFiles(files: readonly File[], request: PhotoLibraryDevelopImportRequestV2): Promise<readonly PhotoLibraryImportItemV1[]>;
}
