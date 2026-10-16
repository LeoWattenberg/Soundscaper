/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ImageHdrMergeResultCurrentV1 } from '../../../common/editor/controller/shared/image-hdr-merge-current-v1.ts';
import { defaultPhotoDevelopV1 } from '../../catalog/develop-state.ts';
import { normalizePhotoDocumentCurrentV1 } from '../../catalog/photo-document-current-v1.ts';
import { emptyPhotoMetadataV1 } from '../../catalog/photo-metadata.ts';
import { id, utcTimestamp } from '../../catalog/value-validation.ts';
import { IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 } from '../../../common/editor/imaging/image-hdr-original-profile-v1.ts';

export function prepareHdrPhotoResultCurrentV1(catalogId: string, fileName: string, view: Readonly<ImageHdrMergeResultCurrentV1>,
	ownership: Readonly<{ photoId: string; originalId: string; storageKey: string; masterVersionId: string }>, createdAt: string) {
	for (const value of Object.values(ownership)) id(value, 'HDR result identity'); utcTimestamp(createdAt, 'HDR result creation time');
	const { width, height } = view.provenance.output;
	const photo = normalizePhotoDocumentCurrentV1({ schemaFamily: 'lightscaper', schemaVersion: 3, kind: 'photo', id: ownership.photoId,
		catalogId, revision: 0, original: { schemaVersion: 1, kind: 'still', id: ownership.originalId, name: fileName,
			mimeType: IMAGE_HDR_ORIGINAL_MIME_TYPE_V1, storageKey: ownership.storageKey, contentSha256: view.sha256, width, height,
			hasAlpha: false, byteLength: view.byteLength, retention: 'managed' }, metadata: emptyPhotoMetadataV1(fileName), extractedMetadata: null,
		folderId: null, collectionIds: [], keywordIds: [], rating: 0, flag: 'unflagged', colorLabel: 'none', activeVersionId: ownership.masterVersionId,
		versions: [{ id: ownership.masterVersionId, kind: 'master', name: 'Original', createdAt, develop: defaultPhotoDevelopV1() }] });
	return Object.freeze({ photo, original: new Blob([view.bytes], { type: IMAGE_HDR_ORIGINAL_MIME_TYPE_V1 }) });
}
