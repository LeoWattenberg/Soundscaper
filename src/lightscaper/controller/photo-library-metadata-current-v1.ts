/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPhotoLibraryMetadataSnapshotForProfileV1 } from './photo-library-scalar-projection-kernel-v1.ts';
import type { PhotoLibraryMetadataSnapshotV1 } from '../../common/editor/photo-library-session-port-v1.ts';

export function readPhotoLibraryMetadataSnapshotCurrentV1(value: unknown): PhotoLibraryMetadataSnapshotV1 {
	return readPhotoLibraryMetadataSnapshotForProfileV1('current3', value);
}
