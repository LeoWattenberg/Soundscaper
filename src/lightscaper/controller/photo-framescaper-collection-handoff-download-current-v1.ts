/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCollectionHandoffPortV2 } from '../../common/editor/photo-library-collection-handoff-port-v2.ts';
import type { PhotoFramescaperCollectionHandoffTarget, PhotoFramescaperCollectionHandoffArchive,
	PhotoFramescaperCollectionHandoffDownloadRequest } from './photo-framescaper-handoff-download.ts';

export interface PhotoFramescaperCollectionHandoffTargetCurrentV1 extends Omit<PhotoFramescaperCollectionHandoffTarget, 'capture'> {
	readonly schemaVersion: 2;
	readonly capture: Readonly<PhotoLibraryCollectionHandoffPortV2>;
}
export type PhotoFramescaperCollectionHandoffTargetSelectedV1 = PhotoFramescaperCollectionHandoffTarget | PhotoFramescaperCollectionHandoffTargetCurrentV1;
export type BuildPhotoFramescaperCollectionHandoffArchiveCurrentV1 = (request: Readonly<{
	capture: Readonly<PhotoLibraryCollectionHandoffPortV2>;
	binding: PhotoFramescaperCollectionHandoffTarget['binding']; signal: AbortSignal;
}>) => Promise<Readonly<PhotoFramescaperCollectionHandoffArchive>>;
export interface PhotoFramescaperCollectionHandoffDownloadRequestCurrentV1 extends Omit<PhotoFramescaperCollectionHandoffDownloadRequest, 'target' | 'buildArchive'> {
	readonly target: Readonly<PhotoFramescaperCollectionHandoffTargetCurrentV1>;
	readonly buildArchive: BuildPhotoFramescaperCollectionHandoffArchiveCurrentV1;
}
export function isPhotoFramescaperCollectionHandoffTargetCurrentV1(target: PhotoFramescaperCollectionHandoffTargetSelectedV1): target is PhotoFramescaperCollectionHandoffTargetCurrentV1 {
	return 'schemaVersion' in target && target.schemaVersion === 2;
}
