/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImageHandoffRequestV1 } from '../../common/editor/photo-library-image-handoff-port-v1.ts';
import type { PhotoLibraryImageHandoffViewV2 } from '../../common/editor/photo-library-image-handoff-port-v2.ts';
import type { PhotoLibrarySessionPortsCurrentV1 } from './photo-library-session-ports-current-v1.ts';
import { withPhotoLibraryImageHandoffForProfileV1 } from './internal/photo-library-image-handoff-kernel-v1.ts';
/** Full Current saved facts and actual dual-body custody share the selected operation. */
export function withPhotoLibraryImageHandoffCurrentV1<Result>(ports: PhotoLibrarySessionPortsCurrentV1, catalogId: string, request: Readonly<PhotoLibraryImageHandoffRequestV1>, consume: (view: Readonly<PhotoLibraryImageHandoffViewV2>) => Result | Promise<Result>, signal: AbortSignal): Promise<Result> {
	return withPhotoLibraryImageHandoffForProfileV1('current3', ports, catalogId, request, view => consume(view as Readonly<PhotoLibraryImageHandoffViewV2>), signal);
}
