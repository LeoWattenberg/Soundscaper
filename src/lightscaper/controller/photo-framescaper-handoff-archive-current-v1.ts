/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffPortV2 } from '../../common/editor/photo-library-image-handoff-port-v2.ts';
import type { PhotoLibraryImageHandoffRequestV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import { exportPhotoFramescaperHandoffArchiveForProfileV1, type PhotoFramescaperHandoffArchiveDependenciesV1, type PhotoFramescaperHandoffArchiveV1 } from './internal/photo-framescaper-handoff-archive-kernel-v1.ts';
export type { PhotoFramescaperHandoffArchiveDependenciesV1, PhotoFramescaperHandoffArchiveV1 } from './internal/photo-framescaper-handoff-archive-kernel-v1.ts';
export interface PhotoFramescaperHandoffArchiveRequestCurrentV1 { readonly capture: Readonly<PhotoLibraryImageHandoffPortV2>; readonly binding: Readonly<PhotoLibraryImageHandoffRequestV1>; readonly signal?: AbortSignal }
export function exportPhotoFramescaperHandoffArchiveCurrentV1(request: Readonly<PhotoFramescaperHandoffArchiveRequestCurrentV1>, dependencies: Readonly<PhotoFramescaperHandoffArchiveDependenciesV1> = {}): Promise<Readonly<PhotoFramescaperHandoffArchiveV1>> { return exportPhotoFramescaperHandoffArchiveForProfileV1('current3', request, dependencies); }
