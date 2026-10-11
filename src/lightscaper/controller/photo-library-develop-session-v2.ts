/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPortV2, PhotoLibraryDevelopSnapshotV2, PhotoLibraryDevelopCommandV2 } from '../../common/editor/photo-library-develop-port-v2.ts';
import { createPhotoLibraryDevelopSessionForProfileV1, readPhotoLibraryDevelopSnapshotForProfileV1,
	normalizePhotoLibraryDevelopCommandForProfileV1, type PhotoLibraryDevelopSessionHostV2 } from './photo-library-develop-session-kernel.ts';

export type { PhotoLibraryDevelopSessionHostV2 } from './photo-library-develop-session-kernel.ts';
/** The existing public owner keeps strict Photo1/2, schema2 and legacy children. */
export function createPhotoLibraryDevelopSessionV2(host: PhotoLibraryDevelopSessionHostV2): Readonly<PhotoLibraryDevelopPortV2> {
	return createPhotoLibraryDevelopSessionForProfileV1('legacy2', host);
}
export function readPhotoLibraryDevelopSnapshotV2(value: unknown, selected?: string): PhotoLibraryDevelopSnapshotV2 {
	return readPhotoLibraryDevelopSnapshotForProfileV1('legacy2', value, selected);
}
export function normalizePhotoLibraryDevelopCommandV2(value: unknown): PhotoLibraryDevelopCommandV2 {
	return normalizePhotoLibraryDevelopCommandForProfileV1('legacy2', value);
}
