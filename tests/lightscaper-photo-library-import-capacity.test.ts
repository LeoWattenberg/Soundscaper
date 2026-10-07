/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoCatalogRootV1 } from '../src/lightscaper/catalog/types.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

function rootWithSpace(spareBytes: number): PhotoCatalogRootV1 {
	const folders = Array.from({ length: 7_000 }, (_, index) => ({ id: `node-${String(index)}`, name: 'x', parentId: null }));
	const root = { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1', name: 'Library',
		revision: 0, photoCount: 0, folders, keywords: [], collections: [] };
	let remaining = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes - spareBytes - new TextEncoder().encode(JSON.stringify(root)).byteLength;
	for (const folder of folders) {
		const extra = Math.min(255, remaining);
		folder.name = 'x'.repeat(1 + extra); remaining -= extra;
		if (remaining === 0) break;
	}
	assert.equal(remaining, 0);
	const result = normalizePhotoCatalogRootV1(root);
	assert.equal(new TextEncoder().encode(JSON.stringify(result)).byteLength, LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes - spareBytes);
	return result;
}

async function open(root: PhotoCatalogRootV1, refuseKeywords = false) {
	const backing = createInstrumentedIndexedDB(), indexedDB = backing as unknown as IDBFactory;
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: `lightscaper-capacity-media-${crypto.randomUUID()}`,
		locks: null, preferOpfs: false, syncWorkerClient: null });
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: `lightscaper-capacity-catalog-${crypto.randomUUID()}`, verifyOriginal: media.verifyOriginal });
	await media.ready(); await catalog.createCatalog(root);
	let identity = 0;
	const session = new PhotoLibrarySessionV1({
		initialize: async () => root,
		closeResources: async () => { await catalog.close(); await media.close(); },
		createId: () => `identity-${String(++identity)}`,
		exclusive: async (_id, operation, signal) => operation(signal),
		catalog: { loadCatalog: catalog.loadCatalog.bind(catalog), loadPhoto: catalog.loadPhoto.bind(catalog),
			publishPhotos: catalog.publishPhotos.bind(catalog), savePhoto: catalog.savePhoto.bind(catalog), readSummaryPage: catalog.readSummaryPage.bind(catalog),
			saveCatalog: async (...args) => {
				if (refuseKeywords) throw new Error('keyword storage blocked');
				return catalog.saveCatalog(...args);
			} },
		media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository,
		prepare: async function* () {
			for (let index = 0; index < 3; index++) {
				const input = photoArchiveFixture(index + 1), keywordNames = index === 1 ? ['Travel'] : [];
				const photo = normalizePhotoDocumentV1({ ...input.photo, original: { ...input.photo.original, mimeType: 'image/jpeg' }, extractedMetadata: {
					schemaVersion: 1, container: 'jpeg', exif: null, issues: [], iptc: { encoding: 'utf8', objectName: null,
						headline: null, caption: null, copyright: null, creators: [], keywords: keywordNames,
						city: null, sublocation: null, state: null, country: null, captureDate: null, captureTime: null },
				} });
				yield { original: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), photo, outcome: 'prepared', index, fileName: photo.metadata.fileName, keywordNames, notices: [] };
			}
		},
	});
	return { session, catalog, media };
}

const selected = () => Array.from({ length: 3 }, (_, index) => new File([new Uint8Array([1, 2, 3])], `Photo ${String(index + 1)}.png`));

test('a nearly full catalog omits an unfit authored keyword and retains all original photos and source facts', async () => {
	const owner = await open(rootWithSpace(30));
	try {
		const receipts = await owner.session.importFiles(selected());
		assert.deepEqual(receipts.map(row => [row.index, row.status, row.hasMetadataNotices]), [[0, 'imported', false], [1, 'imported', true], [2, 'imported', false]]);
		const root = await owner.catalog.loadCatalog('catalog-1');
		assert.equal(root?.photoCount, 3); assert.deepEqual(root?.keywords, []);
		for (let index = 1; index <= 3; index++) {
			const photo = await owner.catalog.loadPhoto('catalog-1', `photo-${String(index)}`);
			assert.ok(photo); await owner.media.verifyOriginal(photo.original);
			assert.deepEqual(photo.keywordIds, []);
			assert.deepEqual(photo.extractedMetadata?.iptc?.keywords, index === 2 ? ['Travel'] : []);
		}
	} finally { await owner.session.close(); }
});

test('a keyword persistence failure reports its selected file and lets the following photo publish', async () => {
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
		name: 'Library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	const owner = await open(root, true);
	try {
		const receipts = await owner.session.importFiles(selected());
		assert.deepEqual(receipts.map(row => [row.index, row.status]), [[0, 'imported'], [1, 'failed'], [2, 'imported']]);
		assert.equal(receipts[1]?.message, 'keyword storage blocked');
		assert.equal((await owner.catalog.loadCatalog('catalog-1'))?.photoCount, 2);
		assert.equal(await owner.catalog.loadPhoto('catalog-1', 'photo-2'), null);
		const last = await owner.catalog.loadPhoto('catalog-1', 'photo-3');
		assert.ok(last); await owner.media.verifyOriginal(last.original);
	} finally { await owner.session.close(); }
});
