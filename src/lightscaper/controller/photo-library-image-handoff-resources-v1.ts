/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CubeLutSourcePortV1 } from '../../common/editor/imaging/cube-lut-source-port-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../../common/editor/video-color-cube-lut-v27.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';
import { withPhotoLibraryImageHandoffResourcesForProfileV1 } from './internal/photo-library-image-handoff-kernel-v1.ts';
export function withPhotoLibraryImageHandoffResourcesV1<Result>(ports: PhotoLibrarySessionPortsV2, references: readonly Readonly<VideoCubeLutReferenceV1>[], signal: AbortSignal, prepare: () => Promise<void>, consume: (withLutBytes: CubeLutSourcePortV1['withBytes']) => Result | Promise<Result>): Promise<Result> {
	return withPhotoLibraryImageHandoffResourcesForProfileV1('legacy2', ports, { luts: references, brushes: [] }, signal, prepare, readers => consume(readers.withLutBytes));
}
