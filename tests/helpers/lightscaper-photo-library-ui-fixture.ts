/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { readClosedDomainField, readClosedDomainRecord } from '../../src/common/editor/closed-domain-value.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';

/** Read a bounded selection through the same production owners after a UI action. */
export async function readResidentPhotoLibraryV1(photoIds: readonly string[]) {
	if (photoIds.length > 64) throw new RangeError('The UI qualification selection exceeds one page.');
	const media = new PhotoMediaStoreV1();
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	try {
		await media.ready();
		const pointer = readClosedDomainRecord(await media.settingsRepository.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1),
			'library pointer', ['schemaVersion', 'kind', 'catalogId']);
		const catalogId = readClosedDomainField(pointer, 'catalogId', 'library pointer');
		if (typeof catalogId !== 'string') throw new TypeError('Library pointer has no catalog identity.');
		const root = await catalog.loadCatalog(catalogId);
		const photos = [];
		for (const photoId of photoIds) {
			const photo = await catalog.loadPhoto(catalogId, photoId);
			if (!photo) throw new ReferenceError('The UI selection was not persisted.');
			const original = await media.mediaRepository.loadAsset(photo.original.storageKey);
			if (!(original instanceof Blob)) throw new TypeError('The retained original is unavailable.');
			photos.push({ id: photo.id, originalId: photo.original.id, storageKey: photo.original.storageKey,
				sha256: photo.original.contentSha256, byteLength: photo.original.byteLength, fileName: photo.metadata.fileName,
				metadata: photo.metadata, extractedMetadata: photo.extractedMetadata, originalName: photo.original.name,
				rating: photo.rating, flag: photo.flag, colorLabel: photo.colorLabel, revision: photo.revision, bytes: Array.from(new Uint8Array(await original.arrayBuffer())) });
		}
		return { root, photos };
	} finally { await Promise.all([catalog.close(), media.close()]); }
}

export type PhotoLibraryUiObservationV1 = Awaited<ReturnType<typeof readResidentPhotoLibraryV1>>;
