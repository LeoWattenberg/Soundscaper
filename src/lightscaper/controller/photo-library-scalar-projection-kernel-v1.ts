/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryMetadataSnapshotV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryMembershipAcknowledgementV1, PhotoLibraryMembershipSnapshotV1 } from '../../common/editor/photo-library-organization-port-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { normalizePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { PHOTO_LIBRARY_METADATA_MAXIMUM_BYTES_V1 } from './photo-library-metadata.ts';
import { normalizePhotoLibraryMembershipReadV1, normalizePhotoLibraryMembershipMutationV1 } from './photo-library-memberships-v1.ts';

export type PhotoLibraryScalarProjectionProfileV1 = 'legacy2' | 'current3';
export interface PhotoLibraryScalarProjectionOwnerV1 {
	readonly history: Readonly<{ present: unknown }>;
	readonly execute?: unknown;
}
/** Fixed owners fully admit the document before its scalar projection escapes. */
export function readPhotoLibraryMetadataSnapshotForProfileV1(profile: PhotoLibraryScalarProjectionProfileV1, value: unknown): PhotoLibraryMetadataSnapshotV1 {
	const photo = normalize(profile, value);
	const snapshot = Object.freeze({ photoId: photo.id, revision: photo.revision, metadata: photo.metadata,
		extracted: photo.extractedMetadata, originalFileName: photo.original.name, originalSha256: photo.original.contentSha256 });
	if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > PHOTO_LIBRARY_METADATA_MAXIMUM_BYTES_V1) {
		throw new RangeError('Photo metadata presentation exceeds its byte budget.');
	}
	return snapshot;
}
export function readPhotoLibraryMembershipsForProfileV1(profile: PhotoLibraryScalarProjectionProfileV1, owner: PhotoLibraryScalarProjectionOwnerV1,
	photoId: string, options: unknown = {}): PhotoLibraryMembershipSnapshotV1 {
	const admitted = normalizePhotoLibraryMembershipReadV1(photoId, options);
	const photo = selected(profile, owner, admitted.photoId); check(admitted.signal); return snapshot(photo);
}
export async function applyPhotoLibraryMembershipsForProfileV1(profile: PhotoLibraryScalarProjectionProfileV1, owner: PhotoLibraryScalarProjectionOwnerV1,
	photoId: string, expectedRevision: unknown, changes: unknown, options: unknown = {}): Promise<PhotoLibraryMembershipAcknowledgementV1> {
	const admitted = normalizePhotoLibraryMembershipMutationV1(photoId, expectedRevision, changes, options);
	const execute = owner.execute;
	if (typeof execute !== 'function') throw new TypeError('Membership changes require the current command owner.');
	const before = selected(profile, owner, admitted.photoId); check(admitted.signal);
	if (before.revision !== admitted.expectedRevision) throw new PhotoCatalogRevisionConflictError('photo');
	const photo = normalize(profile, await Reflect.apply(execute, owner,
		[{ type: 'set-attributes', changes: admitted.changes }, { signal: admitted.signal }]));
	// Native save acknowledgement wins late cancellation; only the fixed scalar owner projects it.
	return Object.freeze({ snapshot: snapshot(photo), row: Object.freeze({ id: photo.id, fileName: photo.metadata.fileName,
		width: photo.original.width, height: photo.original.height, rating: photo.rating, flag: photo.flag, colorLabel: photo.colorLabel }) });
}

function normalize(profile: PhotoLibraryScalarProjectionProfileV1, value: unknown): PhotoDocumentCurrentV1 {
	if (profile === 'legacy2') return normalizePhotoDocumentV1OrV2(value);
	if (profile === 'current3') return normalizePhotoDocumentCurrentV1(value);
	throw new TypeError('Unsupported photo scalar projection profile.');
}
function selected(profile: PhotoLibraryScalarProjectionProfileV1, owner: PhotoLibraryScalarProjectionOwnerV1, photoId: string): PhotoDocumentCurrentV1 {
	const photo = normalize(profile, owner.history.present);
	if (photo.id !== photoId) throw new TypeError('Memberships require the selected photo owner.'); return photo;
}
function snapshot(photo: PhotoDocumentCurrentV1): PhotoLibraryMembershipSnapshotV1 {
	return Object.freeze({ photoId: photo.id, revision: photo.revision, folderId: photo.folderId,
		keywordIds: Object.freeze([...photo.keywordIds]), collectionIds: Object.freeze([...photo.collectionIds]) });
}
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
