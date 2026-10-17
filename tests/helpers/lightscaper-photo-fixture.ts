/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { defaultPhotoDevelopV1 } from '../../src/lightscaper/catalog/develop-state.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { emptyPhotoMetadataV1 } from '../../src/lightscaper/catalog/photo-metadata.ts';

export function photoArchiveFixture(index = 1, bytes = new Uint8Array([1, 2, 3])) {
	const name = `Photo ${index}.png`;
	const photo = normalizePhotoDocumentV1({
		schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo',
		id: `photo-${index}`, catalogId: 'catalog-1', revision: 0,
		original: {
			schemaVersion: 1, kind: 'still', id: `source-${index}`, name,
			mimeType: 'image/png', storageKey: `original-${index}`,
			contentSha256: createHash('sha256').update(bytes).digest('hex'),
			width: 1, height: 1, hasAlpha: false, byteLength: bytes.byteLength, retention: 'managed',
		},
		metadata: emptyPhotoMetadataV1(name), folderId: null, collectionIds: [], keywordIds: [],
		rating: 0, flag: 'unflagged', colorLabel: 'none', activeVersionId: `version-${index}`,
		versions: [{ id: `version-${index}`, kind: 'master', name: 'Original',
			createdAt: '2026-10-07T00:00:00.000Z', develop: defaultPhotoDevelopV1() }],
	});
	return { photo, original: new Blob([bytes], { type: 'image/png' }) };
}
