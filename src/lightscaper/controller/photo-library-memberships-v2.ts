/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryMembershipAcknowledgementV1, PhotoLibraryMembershipSnapshotV1 } from '../../common/editor/photo-library-organization-port-v1.ts';
import type { PhotoCommandOwnerV2 } from './photo-command-owner-v2.ts';
import { readPhotoLibraryMembershipsForProfileV1, applyPhotoLibraryMembershipsForProfileV1 } from './photo-library-scalar-projection-kernel-v1.ts';

/** Fixed current full document admission precedes unchanged scalar membership projection. */
export function readPhotoLibraryMembershipsV2(owner: Pick<PhotoCommandOwnerV2, 'history'>, photoId: string, options: unknown = {}): PhotoLibraryMembershipSnapshotV1 {
	return readPhotoLibraryMembershipsForProfileV1('legacy2', owner, photoId, options);
}

export function applyPhotoLibraryMembershipsV2(owner: Pick<PhotoCommandOwnerV2, 'history' | 'execute'>,
	photoId: string, expectedRevision: unknown, changes: unknown, options: unknown = {}): Promise<PhotoLibraryMembershipAcknowledgementV1> {
	return applyPhotoLibraryMembershipsForProfileV1('legacy2', owner, photoId, expectedRevision, changes, options);
}
