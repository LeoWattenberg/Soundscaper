/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryMetadataSnapshotV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { PHOTO_LIBRARY_METADATA_MAXIMUM_BYTES_V1 } from './photo-library-metadata.ts';

/** Fully admit the mixed aggregate before delivering descriptive fields through the unchanged scalar port. */
export function readPhotoLibraryMetadataSnapshotV2(value: unknown): PhotoLibraryMetadataSnapshotV1 {
	const photo = normalizePhotoDocumentV1OrV2(value);
	const snapshot = Object.freeze({ photoId: photo.id, revision: photo.revision, metadata: photo.metadata,
		extracted: photo.extractedMetadata, originalFileName: photo.original.name, originalSha256: photo.original.contentSha256 });
	if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > PHOTO_LIBRARY_METADATA_MAXIMUM_BYTES_V1) {
		throw new RangeError('Photo metadata presentation exceeds its byte budget.');
	}
	return snapshot;
}
