/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCollectionHandoffPortV1, PhotoLibraryCollectionHandoffRequestV1 } from '../../common/editor/photo-library-collection-handoff-port-v1.ts';
import { exportPhotoFramescaperCollectionHandoffArchiveForProfileV1, type PhotoFramescaperCollectionHandoffArchiveDependenciesV1, type PhotoFramescaperCollectionHandoffArchiveV1 } from './internal/photo-framescaper-collection-handoff-archive-kernel-v1.ts';
export type { PhotoFramescaperCollectionHandoffArchiveDependenciesV1, PhotoFramescaperCollectionHandoffArchiveV1 } from './internal/photo-framescaper-collection-handoff-archive-kernel-v1.ts';
export interface PhotoFramescaperCollectionHandoffArchiveRequestV1 {
	readonly capture: Readonly<PhotoLibraryCollectionHandoffPortV1>; readonly binding: Readonly<PhotoLibraryCollectionHandoffRequestV1>; readonly signal?: AbortSignal;
}
export function exportPhotoFramescaperCollectionHandoffArchiveV1(request: Readonly<PhotoFramescaperCollectionHandoffArchiveRequestV1>,
	dependencies: Readonly<PhotoFramescaperCollectionHandoffArchiveDependenciesV1> = {}): Promise<Readonly<PhotoFramescaperCollectionHandoffArchiveV1>> {
	return exportPhotoFramescaperCollectionHandoffArchiveForProfileV1('legacy2', request, dependencies);
}
