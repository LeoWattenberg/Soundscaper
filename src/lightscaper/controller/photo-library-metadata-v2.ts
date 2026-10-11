/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryMetadataSnapshotV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { readPhotoLibraryMetadataSnapshotForProfileV1 } from './photo-library-scalar-projection-kernel-v1.ts';

/** Fully admit the mixed aggregate before delivering descriptive fields through the unchanged scalar port. */
export function readPhotoLibraryMetadataSnapshotV2(value: unknown): PhotoLibraryMetadataSnapshotV1 {
	return readPhotoLibraryMetadataSnapshotForProfileV1('legacy2', value);
}
