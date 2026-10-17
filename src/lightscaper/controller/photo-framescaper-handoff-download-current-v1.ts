/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffPortV2 } from '../../common/editor/photo-library-image-handoff-port-v2.ts';
import type { PhotoFramescaperHandoffTarget, PhotoFramescaperHandoffArchive, PhotoFramescaperHandoffDownloadRequest } from './photo-framescaper-handoff-download.ts';

export interface PhotoFramescaperHandoffTargetCurrentV1 extends Omit<PhotoFramescaperHandoffTarget, 'capture'> {
	readonly schemaVersion: 2;
	readonly capture: Readonly<PhotoLibraryImageHandoffPortV2>;
}
export type PreparePhotoFramescaperHandoffCurrentV1 = (photoId: string, signal: AbortSignal) => Promise<Readonly<PhotoFramescaperHandoffTargetCurrentV1>>;
export type PreparePhotoFramescaperHandoffSelectedV1 = (photoId: string, signal: AbortSignal) => Promise<Readonly<PhotoFramescaperHandoffTarget | PhotoFramescaperHandoffTargetCurrentV1>>;
export type BuildPhotoFramescaperHandoffArchiveCurrentV1 = (request: Readonly<{
	capture: Readonly<PhotoLibraryImageHandoffPortV2>;
	binding: PhotoFramescaperHandoffTarget['binding']; signal: AbortSignal;
}>) => Promise<Readonly<PhotoFramescaperHandoffArchive>>;
export interface PhotoFramescaperHandoffDownloadRequestCurrentV1 extends Omit<PhotoFramescaperHandoffDownloadRequest, 'target' | 'buildArchive'> {
	readonly target: Readonly<PhotoFramescaperHandoffTargetCurrentV1>;
	readonly buildArchive: BuildPhotoFramescaperHandoffArchiveCurrentV1;
}
export function isPhotoFramescaperHandoffTargetCurrentV1(target: PhotoFramescaperHandoffTarget | PhotoFramescaperHandoffTargetCurrentV1): target is PhotoFramescaperHandoffTargetCurrentV1 {
	return 'schemaVersion' in target && target.schemaVersion === 2;
}
