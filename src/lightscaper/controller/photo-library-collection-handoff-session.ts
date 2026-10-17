/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCollectionHandoffRequestV1, PhotoLibraryCollectionHandoffViewV1 } from '../../common/editor/photo-library-collection-handoff-port-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';
import { withPhotoLibraryCollectionHandoffForProfileV1 } from './internal/photo-library-collection-handoff-kernel-v1.ts';

/** Permanent strict legacy saved-document capture. */
export function withPhotoLibraryCollectionHandoffV1<Result>(ports: PhotoLibrarySessionPortsV2, catalogId: string,
	request: Readonly<PhotoLibraryCollectionHandoffRequestV1>, consume: (view: Readonly<PhotoLibraryCollectionHandoffViewV1>) => Result | Promise<Result>, signal: AbortSignal): Promise<Result> {
	return withPhotoLibraryCollectionHandoffForProfileV1('legacy2', ports, catalogId, request, view => consume(view as Readonly<PhotoLibraryCollectionHandoffViewV1>), signal);
}
