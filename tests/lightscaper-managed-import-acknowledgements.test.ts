/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { importManagedPhotosV1, photoImportIntentKeyV1, recoverManagedPhotoImportV1 } from '../src/lightscaper/import/managed-import-v1.ts';
import type { PhotoManagedImportPortsV1, PhotoManagedImportReceiptV1 } from '../src/lightscaper/import/managed-import-ports-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

async function durableFixture() {
	const backing = createInstrumentedIndexedDB();
	const indexedDB = backing as unknown as IDBFactory;
	const mediaName = `lightscaper-import-ack-media-${crypto.randomUUID()}`;
	const catalogName = `lightscaper-import-ack-catalog-${crypto.randomUUID()}`;
	const open = () => {
		const media = new PhotoMediaStoreV1({ indexedDB, databaseName: mediaName, locks: null, preferOpfs: false, syncWorkerClient: null });
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: catalogName, verifyOriginal: media.verifyOriginal });
		return { media, catalog };
	};
	let owner = open();
	let leases = 0;
	const close = async () => { await owner.catalog.close(); await owner.media.close(); };
	const ports = (): PhotoManagedImportPortsV1 => ({
		catalog: {
			loadCatalog: id => owner.catalog.loadCatalog(id),
			loadPhoto: (catalog, photo) => owner.catalog.loadPhoto(catalog, photo),
			publishPhotos: (...args) => owner.catalog.publishPhotos(...args),
		},
		media: { writeAsset: owner.media.mediaRepository.writeAsset, custody: {
			findDigestPage: (...args) => owner.media.mediaRepository.catalogOriginals.findDigestPage(...args),
			stage: (...args) => owner.media.mediaRepository.catalogOriginals.stage(...args),
			readPage: (...args) => owner.media.mediaRepository.catalogOriginals.readPage(...args),
			promote: (...args) => owner.media.mediaRepository.catalogOriginals.promote(...args),
			releaseStaged: (...args) => owner.media.mediaRepository.catalogOriginals.releaseStaged(...args),
		} },
		journal: owner.media.settingsRepository,
		createImportId: () => 'import-ack-1',
		exclusive: async (_catalog, operation, signal) => { leases++; return operation(signal); },
	});
	await owner.catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Acknowledgment library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	return { ports, close, owner: () => owner, leases: () => leases,
		reopen: async () => { await close(); owner = open(); },
	};
}

function observer(signal?: AbortSignal) {
	const observed: PhotoManagedImportReceiptV1[] = [];
	return { observed, options: { signal, onPublished: (item: PhotoManagedImportReceiptV1) => { observed.push(item); } } };
}

test('a durable publication is acknowledged before custody promotion can fail', async () => {
	const f = await durableFixture(), capture = observer();
	const base = f.ports();
	let first = true;
	const ports: PhotoManagedImportPortsV1 = { ...base, media: { ...base.media, custody: {
		...base.media.custody,
		promote: async (...args) => {
			assert.equal(capture.observed.length, 1, 'acknowledgment precedes promotion');
			if (first) { first = false; throw new Error('promotion acknowledgment interrupted'); }
			await base.media.custody.promote(...args);
		},
	} } };
	try {
		const result = await importManagedPhotosV1('catalog-1', [photoArchiveFixture()], ports, capture.options);
		assert.deepEqual(capture.observed, result);
		assert.equal(capture.observed.length, 1);
		assert.ok(Object.isFrozen(capture.observed[0]));
		assert.equal(await f.owner().media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')), undefined);
	} finally { await f.close(); }
});

test('cancellation with a successful publication acknowledgment reports that photo and preserves its original across reopen', async () => {
	const f = await durableFixture(), stop = new AbortController(), capture = observer(stop.signal);
	const base = f.ports();
	const ports: PhotoManagedImportPortsV1 = { ...base, catalog: { ...base.catalog,
		publishPhotos: async (...args) => { const root = await base.catalog.publishPhotos(...args); stop.abort(); return root; },
	} };
	try {
		await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture(1), photoArchiveFixture(2)], ports, capture.options), { name: 'AbortError' });
		assert.deepEqual(capture.observed, [{ index: 0, photoId: 'photo-1', status: 'imported', reusedOriginal: false, message: null }]);
		assert.equal((await f.owner().catalog.loadCatalog('catalog-1'))?.photoCount, 1);
		assert.equal((await f.owner().media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1', importId: 'import-ack-1' })).roots.length, 1);
		await f.reopen();
		const photo = await f.owner().catalog.loadPhoto('catalog-1', 'photo-1');
		assert.ok(photo);
		await f.owner().media.verifyOriginal(photo.original);
		await assert.rejects(f.owner().media.mediaRepository.deleteAsset(photo.original.storageKey), /catalog original/u);
		await recoverManagedPhotoImportV1('catalog-1', f.ports());
		assert.equal((await f.owner().media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' })).roots.length, 1);
		assert.equal(await f.owner().media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')), undefined);
		const original = await f.owner().media.mediaRepository.loadAsset(photo.original.storageKey);
		assert.ok(original); assert.deepEqual(new Uint8Array(await original.arrayBuffer()), new Uint8Array([1, 2, 3]));
	} finally { await f.close(); }
});

test('a lost publication acknowledgment is reported once after exact resident identity is confirmed', async () => {
	const f = await durableFixture(), capture = observer();
	const base = f.ports();
	const ports: PhotoManagedImportPortsV1 = { ...base, catalog: { ...base.catalog,
		publishPhotos: async (...args) => { await base.catalog.publishPhotos(...args); throw new Error('lost publication acknowledgment'); },
	} };
	try {
		const results = await importManagedPhotosV1('catalog-1', [photoArchiveFixture()], ports, capture.options);
		assert.deepEqual(capture.observed, results); assert.equal(capture.observed.length, 1);
		assert.equal(results[0]?.status, 'imported');
	} finally { await f.close(); }
});

test('an aborted ambiguous publication reports no unconfirmed acknowledgment and stays recoverable', async () => {
	const f = await durableFixture(), stop = new AbortController(), capture = observer(stop.signal);
	const base = f.ports();
	const ports: PhotoManagedImportPortsV1 = { ...base, catalog: { ...base.catalog,
		publishPhotos: async (...args) => { await base.catalog.publishPhotos(...args); stop.abort(); throw new Error('lost acknowledgment'); },
	} };
	try {
		await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture()], ports, capture.options), { name: 'AbortError' });
		assert.deepEqual(capture.observed, []);
		assert.equal((await f.owner().catalog.loadCatalog('catalog-1'))?.photoCount, 1);
		await f.reopen(); await recoverManagedPhotoImportV1('catalog-1', f.ports());
		assert.equal((await f.owner().media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' })).roots.length, 1);
	} finally { await f.close(); }
});

test('refused publications emit no success, while subsequent successes keep their per-file indices', async () => {
	const f = await durableFixture(), capture = observer();
	const base = f.ports(); let first = true;
	const ports: PhotoManagedImportPortsV1 = { ...base, catalog: { ...base.catalog,
		publishPhotos: async (...args) => {
			if (first) { first = false; throw new Error('publication refused'); }
			return base.catalog.publishPhotos(...args);
		},
	} };
	try {
		const results = await importManagedPhotosV1('catalog-1', [photoArchiveFixture(1), photoArchiveFixture(2)], ports, capture.options);
		assert.deepEqual(results.map(item => item.status), ['failed', 'imported']);
		assert.deepEqual(capture.observed, [results[1]]); assert.equal(capture.observed[0]?.index, 1);
		assert.equal((await f.owner().catalog.loadCatalog('catalog-1'))?.photoCount, 1);
	} finally { await f.close(); }
});

test('observer exceptions cannot veto publication or block the next original', async () => {
	const f = await durableFixture(); const observed: PhotoManagedImportReceiptV1[] = [];
	const options = { signal: undefined, onPublished: (item: PhotoManagedImportReceiptV1) => { observed.push(item); throw new Error('observer failed'); } };
	try {
		const results = await importManagedPhotosV1('catalog-1', [photoArchiveFixture(1), photoArchiveFixture(2)], f.ports(), options);
		assert.deepEqual(observed, results); assert.equal(observed.length, 2);
		assert.deepEqual(results.map(item => item.reusedOriginal), [false, true]);
		assert.equal((await f.owner().catalog.loadCatalog('catalog-1'))?.photoCount, 2);
	} finally { await f.close(); }
});

test('intent retirement failure cannot erase already acknowledged durable publications', async () => {
	const f = await durableFixture(), capture = observer();
	const base = f.ports();
	const ports: PhotoManagedImportPortsV1 = { ...base, journal: {
		get: key => base.journal.get(key), putIfAbsent: (key, value) => base.journal.putIfAbsent(key, value),
		deleteIfCurrent: async () => { throw new Error('retirement interrupted'); },
	} };
	try {
		await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture(1), photoArchiveFixture(2)], ports, capture.options), /retirement/u);
		assert.deepEqual(capture.observed.map(item => item.photoId), ['photo-1', 'photo-2']);
		await f.reopen(); await recoverManagedPhotoImportV1('catalog-1', f.ports());
		assert.equal((await f.owner().catalog.loadCatalog('catalog-1'))?.photoCount, 2);
		assert.equal((await f.owner().media.mediaRepository.catalogOriginals.readPage({ catalogId: 'catalog-1' })).roots.length, 2);
	} finally { await f.close(); }
});

test('closed observer options and pre-aborted signals refuse before acquiring any writer lease', async () => {
	const f = await durableFixture(); let getters = 0;
	try {
		const accessor = Object.defineProperty({ signal: undefined }, 'onPublished', { enumerable: true,
			get: () => { getters++; throw new Error('observer getter invoked'); } });
		await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture()], f.ports(), accessor), TypeError);
		const stop = new AbortController(); stop.abort();
		await assert.rejects(importManagedPhotosV1('catalog-1', [photoArchiveFixture()], f.ports(), { signal: stop.signal }), { name: 'AbortError' });
		assert.equal(getters, 0); assert.equal(f.leases(), 0);
		assert.equal((await f.owner().catalog.loadCatalog('catalog-1'))?.photoCount, 0);
		assert.equal(await f.owner().media.settingsRepository.get(photoImportIntentKeyV1('catalog-1')), undefined);
	} finally { await f.close(); }
});
