/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCollectionHandoffPortV2, PhotoLibraryCollectionHandoffRequestV2 } from '../../common/editor/photo-library-collection-handoff-port-v2.ts';
import { exportPhotoFramescaperCollectionHandoffArchiveForProfileV1, type PhotoFramescaperCollectionHandoffArchiveDependenciesV1, type PhotoFramescaperCollectionHandoffArchiveV1 } from './internal/photo-framescaper-collection-handoff-archive-kernel-v1.ts';
export type { PhotoFramescaperCollectionHandoffArchiveDependenciesV1, PhotoFramescaperCollectionHandoffArchiveV1 } from './internal/photo-framescaper-collection-handoff-archive-kernel-v1.ts';
export interface PhotoFramescaperCollectionHandoffArchiveRequestCurrentV1 {
	readonly capture: Readonly<PhotoLibraryCollectionHandoffPortV2>; readonly binding: Readonly<PhotoLibraryCollectionHandoffRequestV2>; readonly signal?: AbortSignal;
}
export function exportPhotoFramescaperCollectionHandoffArchiveCurrentV1(request: Readonly<PhotoFramescaperCollectionHandoffArchiveRequestCurrentV1>,
	dependencies: Readonly<PhotoFramescaperCollectionHandoffArchiveDependenciesV1> = {}): Promise<Readonly<PhotoFramescaperCollectionHandoffArchiveV1>> {
	return exportPhotoFramescaperCollectionHandoffArchiveForProfileV1('current3', request, dependencies);
}
