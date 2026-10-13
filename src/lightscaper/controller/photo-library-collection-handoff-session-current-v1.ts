/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCollectionHandoffRequestV2, PhotoLibraryCollectionHandoffViewV2 } from '../../common/editor/photo-library-collection-handoff-port-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import { withPhotoLibraryCollectionHandoffForProfileV1 } from './internal/photo-library-collection-handoff-kernel-v1.ts';

/** Full retained Current admission precedes the selected dual-resource scope. */
export function withPhotoLibraryCollectionHandoffCurrentV1<Result>(ports: PhotoLibrarySessionPortsCurrentV1, catalogId: string,
	request: Readonly<PhotoLibraryCollectionHandoffRequestV2>, consume: (view: Readonly<PhotoLibraryCollectionHandoffViewV2>) => Result | Promise<Result>, signal: AbortSignal): Promise<Result> {
	return withPhotoLibraryCollectionHandoffForProfileV1('current3', ports, catalogId, request, view => consume(view as Readonly<PhotoLibraryCollectionHandoffViewV2>), signal);
}
