/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffRequestV1, PhotoLibraryImageHandoffViewV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';
import { withPhotoLibraryImageHandoffForProfileV1 } from './internal/photo-library-image-handoff-kernel-v1.ts';
/** Permanent strict legacy saved-document capture. */
export function withPhotoLibraryImageHandoff<Result>(ports: PhotoLibrarySessionPortsV2, catalogId: string, request: Readonly<PhotoLibraryImageHandoffRequestV1>, consume: (view: Readonly<PhotoLibraryImageHandoffViewV1>) => Result | Promise<Result>, signal: AbortSignal): Promise<Result> {
	return withPhotoLibraryImageHandoffForProfileV1('legacy2', ports, catalogId, request, view => consume(view as Readonly<PhotoLibraryImageHandoffViewV1>), signal);
}
