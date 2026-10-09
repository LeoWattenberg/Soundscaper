/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryMembershipAcknowledgementV1, PhotoLibraryMembershipSnapshotV1 } from '../../common/editor/photo-library-organization-port-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoCommandOwnerV2 } from './photo-command-owner-v2.ts';
import { normalizePhotoLibraryMembershipReadV1, normalizePhotoLibraryMembershipMutationV1 } from './photo-library-memberships-v1.ts';

/** Fixed current full document admission precedes unchanged scalar membership projection. */
export function readPhotoLibraryMembershipsV2(owner: Pick<PhotoCommandOwnerV2, 'history'>, photoId: string, options: unknown = {}): PhotoLibraryMembershipSnapshotV1 {
	const admitted = normalizePhotoLibraryMembershipReadV1(photoId, options);
	const photo = selected(owner, admitted.photoId); check(admitted.signal); return snapshot(photo);
}

export async function applyPhotoLibraryMembershipsV2(owner: Pick<PhotoCommandOwnerV2, 'history' | 'execute'>,
	photoId: string, expectedRevision: unknown, changes: unknown, options: unknown = {}): Promise<PhotoLibraryMembershipAcknowledgementV1> {
	const admitted = normalizePhotoLibraryMembershipMutationV1(photoId, expectedRevision, changes, options);
	const execute = owner.execute;
	if (typeof execute !== 'function') throw new TypeError('Membership changes require the current command owner.');
	const before = selected(owner, admitted.photoId); check(admitted.signal);
	if (before.revision !== admitted.expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
	const photo = normalizePhotoDocumentV1OrV2(await Reflect.apply(execute, owner,
		[{ type: 'set-attributes', changes: admitted.changes }, { signal: admitted.signal }]));
	// The owning save acknowledged before this continuation; late cancellation cannot revoke it.
	return Object.freeze({ snapshot: snapshot(photo), row: Object.freeze({ id: photo.id, fileName: photo.metadata.fileName,
		width: photo.original.width, height: photo.original.height, rating: photo.rating, flag: photo.flag, colorLabel: photo.colorLabel }) });
}

function selected(owner: Pick<PhotoCommandOwnerV2, 'history'>, photoId: string) {
	const photo = normalizePhotoDocumentV1OrV2(owner.history.present);
	if (photo.id !== photoId) throw new TypeError('Memberships require the selected photo owner.'); return photo;
}
function snapshot(photo: Pick<PhotoDocumentV1, 'id' | 'revision' | 'folderId' | 'keywordIds' | 'collectionIds'>): PhotoLibraryMembershipSnapshotV1 {
	return Object.freeze({ photoId: photo.id, revision: photo.revision, folderId: photo.folderId,
		keywordIds: Object.freeze([...photo.keywordIds]), collectionIds: Object.freeze([...photo.collectionIds]) });
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
