/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryMetadataPatchV1, PhotoLibraryMetadataSnapshotV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { emptyPhotoMetadataV1, normalizePhotoMetadataV1 } from '../catalog/photo-metadata.ts';
import { field, record } from '../catalog/value-validation.ts';

export const PHOTO_LIBRARY_METADATA_MAXIMUM_BYTES_V1 = 1024 * 1024;
const EDITABLE_FIELDS = ['fileName', 'title', 'caption', 'creator', 'copyright', 'location', 'captureTime'] as const;

/** Reuse L2 field normalization after proving the patch has only inert authored fields. */
export function normalizePhotoLibraryMetadataPatchV1(value: unknown): PhotoLibraryMetadataPatchV1 {
	const input = record(value, 'photo metadata patch', EDITABLE_FIELDS, []);
	if (Object.keys(input).length === 0) throw new RangeError('Photo metadata patch is empty.');
	const present = EDITABLE_FIELDS.filter(key => Object.hasOwn(input, key));
	const snapshot = Object.fromEntries(present.map(key => [key, field(input, key)]));
	const normalized = normalizePhotoMetadataV1({ ...emptyPhotoMetadataV1('Photo'), ...snapshot });
	return Object.freeze(Object.fromEntries(present
		.map(key => [key, normalized[key]]))) as PhotoLibraryMetadataPatchV1;
}

export function readPhotoLibraryMetadataSnapshotV1(value: unknown): PhotoLibraryMetadataSnapshotV1 {
	const photo = normalizePhotoDocumentV1(value);
	const snapshot = Object.freeze({ photoId: photo.id, revision: photo.revision, metadata: photo.metadata,
		extracted: photo.extractedMetadata, originalFileName: photo.original.name, originalSha256: photo.original.contentSha256 });
	if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > PHOTO_LIBRARY_METADATA_MAXIMUM_BYTES_V1) {
		throw new RangeError('Photo metadata presentation exceeds its byte budget.');
	}
	return snapshot;
}
