/* SPDX-License-Identifier: AGPL-3.0-only */

import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { validateLightscaperDocumentV1 } from '../../src/lightscaper/catalog/documents.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { openDefaultPhotoCatalogV1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { seedPhotoLibraryQueryNativeV1 } from './lightscaper-photo-query-native-fixture.ts';

/** The same real decode/custody publication used by the committed query witness. */
export async function seedPhotoCatalogOrganizationNativeV1(locale: string) {
	return { ...await seedPhotoLibraryQueryNativeV1(), copy: bundledLightscaperEditorCopyForLocale(locale) };
}

/** A bounded read-only observer; no fixture command substitutes for a menu action. */
export async function readPhotoCatalogOrganizationNativeV1(photoIds: readonly string[] = []) {
	if (photoIds.length > 4 || new Set(photoIds).size !== photoIds.length) throw new RangeError('Organization observation exceeds four distinct photos.');
	const media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	try {
		await media.ready();
		const current = await openDefaultPhotoCatalogV1({ catalog, settings: media.settingsRepository }, { name: 'Query fixture library' });
		const root = validateLightscaperDocumentV1(current);
		if (root.kind !== 'photo-catalog') throw new TypeError('Organization root is not a catalog.');
		if (root.folders.length + root.keywords.length + root.collections.length > 128) throw new RangeError('Organization observation exceeds 128 definitions.');
		const photos = [];
		for (const id of photoIds) {
			const stored = await catalog.loadPhoto(root.id, id);
			const photo = validateLightscaperDocumentV1(stored);
			if (photo.kind !== 'photo') throw new TypeError('Organization observation is not a photo.');
			const body = await media.mediaRepository.loadAsset(photo.original.storageKey);
			if (!(body instanceof Blob)) throw new TypeError('Retained organization original is missing.');
			if (body.size > 1_024) throw new RangeError('Organization observation exceeds its tiny PNG original budget.');
			const digest = await crypto.subtle.digest('SHA-256', await body.arrayBuffer());
			photos.push({ id: photo.id, revision: photo.revision, folderId: photo.folderId, keywordIds: photo.keywordIds, collectionIds: photo.collectionIds,
				rating: photo.rating, flag: photo.flag, colorLabel: photo.colorLabel, original: photo.original, metadata: photo.metadata,
				extractedMetadata: photo.extractedMetadata, versions: photo.versions, activeVersionId: photo.activeVersionId,
				byteLength: body.size, actualSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') });
		}
		return { catalogId: root.id, revision: root.revision, photoCount: root.photoCount,
			folders: root.folders, keywords: root.keywords, collections: root.collections, photos };
	} finally { await Promise.all([catalog.close(), media.close()]); }
}
