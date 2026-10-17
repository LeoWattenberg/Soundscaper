/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryMembershipAcknowledgementV1, PhotoLibraryMembershipSnapshotV1 } from '../../common/editor/photo-library-organization-port-v1.ts';
import type { PhotoCommandOwnerCurrentV1 } from './photo-command-owner-current-v1.ts';
import { readPhotoLibraryMembershipsForProfileV1, applyPhotoLibraryMembershipsForProfileV1 } from './photo-library-scalar-projection-kernel-v1.ts';

export function readPhotoLibraryMembershipsCurrentV1(owner: Pick<PhotoCommandOwnerCurrentV1, 'history'>, photoId: string,
	options: unknown = {}): PhotoLibraryMembershipSnapshotV1 {
	return readPhotoLibraryMembershipsForProfileV1('current3', owner, photoId, options);
}
export function applyPhotoLibraryMembershipsCurrentV1(owner: Pick<PhotoCommandOwnerCurrentV1, 'history' | 'execute'>, photoId: string,
	expectedRevision: unknown, changes: unknown, options: unknown = {}): Promise<PhotoLibraryMembershipAcknowledgementV1> {
	return applyPhotoLibraryMembershipsForProfileV1('current3', owner, photoId, expectedRevision, changes, options);
}
