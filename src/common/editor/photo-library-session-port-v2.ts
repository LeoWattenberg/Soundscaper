/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortV1 } from './photo-library-session-port-v1.ts';
import type { PhotoLibraryDevelopPortV2 } from './photo-library-develop-port-v2.ts';
import type { PhotoLibraryDevelopImportPortV2 } from './photo-library-develop-import-port-v2.ts';
import type { PhotoLibraryCubeLutPortV1 } from './photo-library-cube-lut-port-v1.ts';

/** A body-free, complete selected-version export projection; product schemas remain private. */
export interface PhotoLibraryExportSidecarRequest {
	readonly catalogId: string; readonly photoId: string; readonly versionId: string; readonly expectedRevision: number;
}
export type ReadPhotoExportSidecar = (request: Readonly<PhotoLibraryExportSidecarRequest>, options: Readonly<{ signal: AbortSignal }>) => Promise<string>;

/** Fixed current Develop envelopes; scalar library and organization ports stay unchanged. */
export interface PhotoLibrarySessionPortV2 extends Omit<PhotoLibrarySessionPortV1, 'develop' | 'developImport'> {
	readonly develop: Readonly<PhotoLibraryDevelopPortV2>;
	readonly developImport: Readonly<PhotoLibraryDevelopImportPortV2>;
	readonly cubeLuts: Readonly<PhotoLibraryCubeLutPortV1>;
	readonly readExportSidecar?: ReadPhotoExportSidecar;
}
export type CreatePhotoLibrarySessionV3 = () => Promise<PhotoLibrarySessionPortV2>;
