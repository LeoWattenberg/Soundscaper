/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { importManagedPhotosV1, photoImportIntentKeyV1, recoverManagedPhotoImportV1 } from '../src/lightscaper/import/managed-import-v1.ts';
import type { PhotoManagedImportPortsV1 } from '../src/lightscaper/import/managed-import-ports-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import type { qualifyManagedImportNativeV1 } from './helpers/lightscaper-managed-import-native-fixture.ts';

const scenarios = ['dedupe', 'published-abort'] satisfies readonly Parameters<typeof qualifyManagedImportNativeV1>[0][];

for (const scenario of scenarios) {
	test(`managed import joins separate durable repository owners through ${scenario} and reopen`, async () => {
		const backing = createInstrumentedIndexedDB();
		const indexedDB = backing as unknown as IDBFactory;
		const mediaName = `lightscaper-managed-media-${crypto.randomUUID()}`;
		const catalogName = `lightscaper-managed-catalog-${crypto.randomUUID()}`;
		const open = () => {
			const media = new PhotoMediaStoreV1({ indexedDB, databaseName: mediaName, locks: null, preferOpfs: false, syncWorkerClient: null });
			const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: catalogName, verifyOriginal: media.verifyOriginal });
			return { media, catalog, close: async () => { await catalog.close(); await media.close(); } };
		};
		let owner = open();
		const createPorts = (): PhotoManagedImportPortsV1 => ({
			catalog: owner.catalog,
			media: { writeAsset: owner.media.mediaRepository.writeAsset, custody: owner.media.mediaRepository.catalogOriginals },
			journal: owner.media.settingsRepository, createImportId: () => 'import-1',
			exclusive: async (_catalog, operation, signal) => operation(signal),
		});
		try {
			await owner.catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
				id: 'catalog-1', name: 'Integration', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
			if (scenario === 'dedupe') {
				const receipts = await importManagedPhotosV1('catalog-1', [photoArchiveFixture(1), photoArchiveFixture(2)], createPorts());
				assert.deepEqual(receipts.map(({ status, reusedOriginal }) => [status, reusedOriginal]), [['imported', false], ['imported', true]]);
			} else {
				const stop = new AbortController();
				const base = createPorts();
				const interrupted: PhotoManagedImportPortsV1 = { ...base, catalog: {
					loadCatalog: (id) => owner.catalog.loadCatalog(id), loadPhoto: (catalog, photo) => owner.catalog.loadPhoto(catalog, photo),
					publishPhotos: async (...args) => { const root = await owner.catalog.publishPhotos(...args); stop.abort(); return root; },
				} };
				await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture()], interrupted, { signal: stop.signal }), { name: 'AbortError' });
				assert.equal(await owner.media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')) !== undefined, true);
			}
			await owner.close(); owner = open();
			assert.notEqual(mediaName, catalogName);
			assert.equal(backing.recordCount(mediaName, 'mediaAssets'), 1);
			const first = await owner.catalog.loadPhoto('catalog-1', 'photo-1');
			assert.ok(first);
			await owner.media.verifyOriginal(first.original);
			await assert.rejects(owner.media.mediaRepository.deleteAsset(first.original.storageKey), /catalog original/u);
			if (scenario === 'published-abort') {
				assert.equal((await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1', importId: 'import-1' })).roots.length, 1);
				await recoverManagedPhotoImportV1('catalog-1', createPorts());
				assert.equal((await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1', importId: 'import-1' })).roots.length, 0);
			} else {
				const second = await owner.catalog.loadPhoto('catalog-1', 'photo-2');
				assert.ok(second);
				assert.notEqual(first.original.id, second.original.id);
				assert.equal(first.original.storageKey, second.original.storageKey);
				assert.notEqual(first.activeVersionId, second.activeVersionId);
			}
			assert.equal(await owner.media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')), undefined);
			const roots = await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' });
			assert.equal(roots.roots.length, scenario === 'dedupe' ? 2 : 1);
			const bytes = await owner.media.mediaRepository.loadAsset(first.original.storageKey);
			assert.ok(bytes);
			assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()), new Uint8Array([1, 2, 3]));
			assert.equal((await owner.catalog.loadCatalog('catalog-1'))?.photoCount, roots.roots.length);
		} finally { await owner.close(); }
	});
}
