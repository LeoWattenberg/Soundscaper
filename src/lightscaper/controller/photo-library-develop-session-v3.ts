/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPortV3, PhotoLibraryDevelopSnapshotV3, PhotoLibraryDevelopCommandV3 } from '../../common/editor/photo-library-develop-port-v3.ts';
import { createPhotoLibraryDevelopSessionForProfileV1, readPhotoLibraryDevelopSnapshotForProfileV1,
	normalizePhotoLibraryDevelopCommandForProfileV1, type PhotoLibraryDevelopSessionHostV3 } from './photo-library-develop-session-kernel.ts';

export type { PhotoLibraryDevelopSessionHostV3 } from './photo-library-develop-session-kernel.ts';
/** Complete current read/apply/original custody, without legacy settings/preset projection. */
export function createPhotoLibraryDevelopSessionV3(host: PhotoLibraryDevelopSessionHostV3): Readonly<PhotoLibraryDevelopPortV3> {
	return createPhotoLibraryDevelopSessionForProfileV1('current3', host);
}
export function readPhotoLibraryDevelopSnapshotV3(value: unknown, selected?: string): PhotoLibraryDevelopSnapshotV3 {
	return readPhotoLibraryDevelopSnapshotForProfileV1('current3', value, selected);
}
export function normalizePhotoLibraryDevelopCommandV3(value: unknown): PhotoLibraryDevelopCommandV3 {
	return normalizePhotoLibraryDevelopCommandForProfileV1('current3', value);
}
