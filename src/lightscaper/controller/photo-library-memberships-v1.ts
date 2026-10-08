/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryMembershipAcknowledgementV1, PhotoLibraryMembershipSnapshotV1 } from '../../common/editor/photo-library-organization-port-v1.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoDocumentV1 } from '../catalog/types.ts';
import { field, id, integer, record, uniqueIds } from '../catalog/value-validation.ts';
import type { PhotoCommandOwnerV1 } from './photo-command-owner.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from './photo-library-query-v1.ts';

export function normalizePhotoLibraryMembershipReadV1(photoId: unknown, options: unknown = {}) {
	return Object.freeze({ ...admitPhotoLibraryQueryBuildRequestV1(options), photoId: id(photoId, 'photo ID') });
}

export function normalizePhotoLibraryMembershipMutationV1(photoId: unknown, expectedRevision: unknown, changes: unknown, options: unknown = {}) {
	const admitted = normalizePhotoLibraryMembershipReadV1(photoId, options);
	const revision = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'expected photo revision');
	const input = record(changes, 'photo membership changes', ['folderId', 'keywordIds', 'collectionIds'], []);
	const hasFolder = Object.hasOwn(input, 'folderId'), folder = hasFolder ? field(input, 'folderId') : null;
	const patch = Object.freeze({ ...(hasFolder ? { folderId: folder === null ? null : id(folder, 'folder ID') } : {}),
		...(Object.hasOwn(input, 'keywordIds') ? { keywordIds: uniqueIds(field(input, 'keywordIds'), 'keyword IDs', LIGHTSCAPER_CATALOG_LIMITS.maximumMemberships) } : {}),
		...(Object.hasOwn(input, 'collectionIds') ? { collectionIds: uniqueIds(field(input, 'collectionIds'), 'manual collection IDs', LIGHTSCAPER_CATALOG_LIMITS.maximumMemberships) } : {}) });
	return Object.freeze({ ...admitted, expectedRevision: revision, changes: patch });
}

/** The session supplies its already selected owner, after its fresh-photo recheck. */
export function readPhotoLibraryMembershipsV1(owner: Pick<PhotoCommandOwnerV1, 'history'>, photoId: string, options: unknown = {}): PhotoLibraryMembershipSnapshotV1 {
	const admitted = normalizePhotoLibraryMembershipReadV1(photoId, options);
	return snapshot(readSelectedPhoto(owner, admitted.photoId));
}

/** Existing durable commands own history, original invariants and atomic current-root references. */
export async function applyPhotoLibraryMembershipsV1(
	owner: Pick<PhotoCommandOwnerV1, 'history' | 'execute'>, photoId: string, expectedRevision: unknown, changes: unknown, options: unknown = {},
): Promise<PhotoLibraryMembershipAcknowledgementV1> {
	const admitted = normalizePhotoLibraryMembershipMutationV1(photoId, expectedRevision, changes, options);
	const before = readSelectedPhoto(owner, admitted.photoId);
	if (before.revision !== admitted.expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
	const photo = await owner.execute({ type: 'set-attributes', changes: admitted.changes }, { signal: admitted.signal });
	// No cancellation check after acknowledgment: savePhoto has already committed.
	return Object.freeze({ snapshot: snapshot(photo), row: Object.freeze({ id: photo.id, fileName: photo.metadata.fileName,
		width: photo.original.width, height: photo.original.height, rating: photo.rating, flag: photo.flag, colorLabel: photo.colorLabel }) });
}

function readSelectedPhoto(owner: Pick<PhotoCommandOwnerV1, 'history'>, photoId: string): PhotoDocumentV1 {
	const photo = validateLightscaperDocumentV1(owner.history.present);
	if (photo.kind !== 'photo' || photo.id !== photoId) throw new TypeError('Memberships require the selected photo owner.');
	return photo;
}

function snapshot(photo: PhotoDocumentV1): PhotoLibraryMembershipSnapshotV1 {
	return Object.freeze({ photoId: photo.id, revision: photo.revision, folderId: photo.folderId,
		keywordIds: Object.freeze([...photo.keywordIds]), collectionIds: Object.freeze([...photo.collectionIds]) });
}
