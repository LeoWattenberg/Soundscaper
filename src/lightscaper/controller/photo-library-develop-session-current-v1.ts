/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopPortCurrentV1, PhotoLibraryDevelopSnapshotCurrentV1,
	PhotoLibraryDevelopCommandCurrentV1 } from '../../common/editor/photo-library-develop-port-current-v1.ts';
import { createPhotoLibraryDevelopSessionForProfileV1, readPhotoLibraryDevelopSnapshotForProfileV1,
	normalizePhotoLibraryDevelopCommandForProfileV1, type PhotoLibraryDevelopSessionHostCurrentV1 } from './photo-library-develop-session-kernel.ts';

export type { PhotoLibraryDevelopSessionHostCurrentV1 } from './photo-library-develop-session-kernel.ts';
export function createPhotoLibraryDevelopSessionCurrentV1(host: PhotoLibraryDevelopSessionHostCurrentV1): Readonly<PhotoLibraryDevelopPortCurrentV1> {
	return createPhotoLibraryDevelopSessionForProfileV1('current4', host);
}
export function readPhotoLibraryDevelopSnapshotCurrentV1(value: unknown, selected?: string): PhotoLibraryDevelopSnapshotCurrentV1 {
	return readPhotoLibraryDevelopSnapshotForProfileV1('current4', value, selected);
}
export function normalizePhotoLibraryDevelopCommandCurrentV1(value: unknown): PhotoLibraryDevelopCommandCurrentV1 {
	return normalizePhotoLibraryDevelopCommandForProfileV1('current4', value);
}
