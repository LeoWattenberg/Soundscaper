/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { PHOTO_CATALOG_DATABASE_VERSION } from '../../src/lightscaper/catalog/repository-types.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { preparePhotoImportGestureV1 } from '../../src/lightscaper/import/photo-import-preparation-v1.ts';
import { importManagedPhotosV1 } from '../../src/lightscaper/import/managed-import-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { openDefaultPhotoCatalogV1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==';
const photoId = (index: number) => `query-photo-${String(index).padStart(3, '0')}`;

function owners() {
	const media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	return { media, catalog, close: async () => { await Promise.all([catalog.close(), media.close()]); } };
}
async function rootFor(f: ReturnType<typeof owners>) {
	await f.media.ready();
	return openDefaultPhotoCatalogV1({ catalog: f.catalog, settings: f.media.settingsRepository }, { name: 'Query fixture library' });
}
async function hash(body: Blob) {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await body.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Bounded setup through real shared decode, managed original custody and canonical CAS publication. */
export async function seedPhotoLibraryQueryNativeV1() {
	const f = owners(), bytes = Uint8Array.from(atob(PNG), character => character.charCodeAt(0));
	try {
		const initial = await rootFor(f);
		if (initial.photoCount !== 0) throw new RangeError('The query witness requires an isolated empty browser catalog.');
		let root = await f.catalog.saveCatalog(normalizePhotoCatalogRootV1({ ...initial,
			folders: [...Array.from({ length: 70 }, (_, index) => ({ id: `folder-${String(index).padStart(3, '0')}`,
				name: `Folder ${String(index).padStart(3, '0')}`, parentId: null })), { id: 'nested-folder', name: 'Nested folder', parentId: 'folder-069' }],
			keywords: [{ id: 'landscape', name: 'Landscape', parentId: null }],
			collections: [{ id: 'manual', name: 'Manual photos', kind: 'manual' }, { id: 'smart', name: 'Live picks', kind: 'smart', query: {
				kind: 'all', terms: [{ kind: 'rating', minimum: 4, maximum: 5 }, { kind: 'keyword', id: 'landscape' },
					{ kind: 'not', term: { kind: 'flag', value: 'reject' } }],
			} }],
		}), initial.revision);
		const managed = { catalog: f.catalog, media: { writeAsset: f.media.mediaRepository.writeAsset, custody: f.media.mediaRepository.catalogOriginals }, journal: f.media.settingsRepository };
		for (const [offset, count] of [[0, 64], [64, 16]] as const) {
			const files = Array.from({ length: count }, (_, index) => new File([bytes], `Photo-${String(80 - offset - index).padStart(3, '0')}.png`, { type: 'image/png' }));
			const prepared = preparePhotoImportGestureV1({ files, catalog: root, createdAt: '2026-10-08T12:00:00.000Z',
				ownership: files.map((_, index) => ({ photoId: photoId(offset + index), originalId: `query-source-${offset + index}`,
					originalStorageKey: `query-original-${offset + index}`, masterVersionId: `query-master-${offset + index}` })) });
			async function* authored() {
				for await (const outcome of prepared) {
					if (outcome.outcome !== 'prepared') throw outcome.error;
					const index = offset + outcome.index;
					yield { original: outcome.original, photo: normalizePhotoDocumentV1({ ...outcome.photo,
						metadata: { ...outcome.photo.metadata, title: index === 79 ? 'Sparse token' : '',
							captureTime: index % 3 === 0 ? null : { local: `2026-09-${String(index % 28 + 1).padStart(2, '0')}T12:00:00.000`, offsetMinutes: null } },
						folderId: index === 79 ? 'nested-folder' : null, keywordIds: index % 2 === 0 ? ['landscape'] : [],
						collectionIds: index % 3 === 0 ? ['manual'] : [], rating: index % 6,
					}) };
				}
			}
			const receipts = await importManagedPhotosV1(root.id, authored(), managed);
			if (receipts.length !== count || receipts.some(receipt => receipt.status !== 'imported')) throw new Error('Native query fixture publication failed.');
			root = (await f.catalog.loadCatalog(root.id))!;
		}
		return { catalogId: root.id, count: root.photoCount, originalSha256: await hash(new Blob([bytes])), sparsePhotoId: photoId(79),
			filenameAscendingFirst: photoId(79), filenameAscendingLast: photoId(0), smartFirst: photoId(4), smartFirstPageCount: 10, smartCount: 13 };
	} finally { await f.close(); }
}

/** Simulates absent derived rows after an upgrade; immutable documents and custody are untouched. */
export async function invalidatePhotoLibraryQueryIndexNativeV1(catalogId: string) {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open('lightscaper-photo-catalog-v1', PHOTO_CATALOG_DATABASE_VERSION);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(['photoQueryRows', 'photoQueryBuildStates'], 'readwrite');
			transaction.oncomplete = () => { resolve(); }; transaction.onabort = () => { reject(transaction.error); };
			const rows = transaction.objectStore('photoQueryRows'), cursor = rows.index('catalogId').openKeyCursor(IDBKeyRange.only(catalogId)); let count = 0;
			cursor.onsuccess = () => {
				const current = cursor.result; if (!current) return;
				if (++count > 128) { transaction.abort(); return; }
				rows.delete(current.primaryKey); current.continue();
			};
			transaction.objectStore('photoQueryBuildStates').delete(catalogId);
		});
	} finally { database.close(); }
}

export async function readPhotoLibraryQueryOriginalsNativeV1(photoIds: readonly string[]) {
	if (photoIds.length > 64) throw new RangeError('Native query observation exceeds one scalar page.');
	const f = owners();
	try {
		const root = await rootFor(f), originals = [];
		for (const id of photoIds) {
			const photo = await f.catalog.loadPhoto(root.id, id); if (!photo) throw new ReferenceError('Observed photo is missing.');
			const body = await f.media.mediaRepository.loadAsset(photo.original.storageKey);
			if (!(body instanceof Blob)) throw new TypeError('Observed original is missing.');
			originals.push({ photoId: photo.id, expectedSha256: photo.original.contentSha256, actualSha256: await hash(body),
				byteLength: body.size, revision: photo.revision, rating: photo.rating });
		}
		return originals;
	} finally { await f.close(); }
}
