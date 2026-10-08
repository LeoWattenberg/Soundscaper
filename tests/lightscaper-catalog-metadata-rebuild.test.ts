/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from '../src/common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from '../src/lightscaper/catalog/catalog-transaction.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { indexState, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { photoQueryBuildProgressV2, publishPhotoQueryRowV2, readPhotoQueryBuildStateV2 } from '../src/lightscaper/catalog/photo-query-index-storage-v2.ts';
import { rebuildPhotoQueryIndexPageV2 } from '../src/lightscaper/catalog/photo-query-rebuild-v2.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const state = (indexedCount = 0, ready = false, afterKey: string | null = null) => ({ id: 'catalog', schemaVersion: 2, ready, afterKey, indexedCount });
const members = (prefix: string) => Array.from({ length: 1_024 }, (_, index) => `${prefix}${String(index).padStart(4, '0')}${'x'.repeat(123)}`);
function maximalPhoto(index = 0) {
	const base = queryPhotoV1(index), word = '\ud800'.repeat(16_384);
	return normalizePhotoDocumentV1({ ...base, keywordIds: members('k'), collectionIds: members('c'),
		metadata: { ...base.metadata, title: word, caption: word, creator: word, copyright: word, location: word,
			cameraMake: '\ud800'.repeat(1_024), cameraModel: '\ud800'.repeat(1_024), lens: '\ud800'.repeat(1_024), iso: 200 } });
}
function maximalRoot() {
	return { ...queryCatalogRootV1(), keywords: members('k').map(id => ({ id, name: 'K', parentId: null })),
		collections: members('c').map(id => ({ id, name: 'C', kind: 'manual' as const })) };
}
async function opened() {
	const indexedDB = createInstrumentedIndexedDB(), factory = indexedDB as unknown as IDBFactory;
	const database = await openPhotoCatalogDatabaseV1(factory, 'metadata-query', () => undefined);
	const create = () => new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName: 'metadata-query', verifyOriginal: async () => undefined });
	return { indexedDB, database, repository: create(), create };
}
async function legacy(photos: readonly PhotoDocumentV1[] = Array.from({ length: 43 }, (_, index) => queryPhotoV1(index)), version = 3) {
	const indexedDB = createInstrumentedIndexedDB(), factory = indexedDB as unknown as IDBFactory;
	await new Promise<void>((resolve, reject) => {
		const opening = factory.open('metadata-query', version);
		opening.onupgradeneeded = () => {
			for (const name of ['catalogs', 'catalogStates', 'photos', 'summaries', 'memberships', 'photoQueryRows', 'photoQueryBuildStates']) {
				const store = opening.result.createObjectStore(name, { keyPath: name.startsWith('catalog') || name === 'photoQueryBuildStates' ? 'id' : 'key' });
				if (name === 'summaries' || name === 'photoQueryRows') store.createIndex('catalogId', 'catalogId');
				if (name === 'memberships') store.createIndex('scope', 'scope');
			}
		};
		opening.onsuccess = () => { opening.result.close(); resolve(); }; opening.onerror = () => reject(opening.error);
	});
	const root = { ...(photos.some(photo => photo.keywordIds.length === 1_024) ? maximalRoot() : queryCatalogRootV1()), revision: 1, photoCount: photos.length };
	indexedDB.seedRecord('metadata-query', 'catalogs', root); indexedDB.seedRecord('metadata-query', 'catalogStates', indexState(root, 1));
	for (const photo of photos) {
		indexedDB.seedRecord('metadata-query', 'photos', { key: `catalog|${photo.id}`, document: photo });
		indexedDB.seedRecord('metadata-query', 'summaries', photoSummary(photo));
	}
	const create = () => new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName: 'metadata-query', verifyOriginal: async () => undefined });
	const database = await openPhotoCatalogDatabaseV1(factory, 'metadata-query', () => undefined);
	return { indexedDB, database, repository: create(), create };
}

test('V2 build state/progress admission is closed, scoped and bounded without executing getters', () => {
	assert.deepEqual(readPhotoQueryBuildStateV2(state(1, false, 'catalog|photo-1'), 'catalog'), state(1, false, 'catalog|photo-1'));
	let getters = 0;
	for (const value of [{ ...state(), schemaVersion: 3 }, { ...state(), indexedCount: -1 }, { ...state(), indexedCount: 10_000_001 },
		{ ...state(), id: 'foreign' }, { ...state(), afterKey: 'foreign|photo' }, { ...state(), ready: 1 },
		{ ...state(), afterKey: 'catalog|bad|photo' }, { ...state(), future: true },
		Object.defineProperty(state(), 'ready', { get() { getters++; return true; } }), { ...state(), [Symbol('extra')]: 1 }]) {
		assert.throws(() => readPhotoQueryBuildStateV2(value, 'catalog'));
	}
	assert.equal(getters, 0);
	assert.deepEqual(photoQueryBuildProgressV2(16, 4_000_000, 4_000_000, false), { processed: 16, bytes: 4_000_000, derivedBytes: 4_000_000, ready: false });
	for (const [processed, bytes, derivedBytes] of [[17, 0, 0], [1, 8_000_000, 400_000], [0, -1, 0]] as const) {
		assert.throws(() => photoQueryBuildProgressV2(processed, bytes, derivedBytes, false));
	}
	assert.throws(() => Reflect.apply(photoQueryBuildProgressV2, undefined, [0, 0, 0, 1]));
});

test('additive upgrades 1/2/3 create V2 stores without scanning or rewriting any photo', async () => {
	for (const version of [1, 2, 3]) {
		const { indexedDB, database, repository } = await legacy([queryPhotoV1()], version);
		assert.equal(database.version, 5); assert.equal(indexedDB.stats.cursorRequests.length, 0);
		assert.equal(indexedDB.stats.getAllRequests.length, 0); assert.equal(indexedDB.stats.countRequests.length, 0);
		assert.deepEqual((await repository.loadPhoto('catalog', queryPhotoV1().id)), queryPhotoV1());
		assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryRowsV2'), 0); await repository.close();
	}
});

test('new catalog publication writes both profiles and V2 replacement authenticates ready/count presence', async () => {
	const { indexedDB, repository, database } = await opened(); await repository.createCatalog(queryCatalogRootV1());
	assert.deepEqual(indexedDB.records('metadata-query', 'photoQueryBuildStatesV2'), [state(0, true)]);
	await repository.publishPhotos('catalog', 0, [queryPhotoV1()]);
	const row = projectPhotoQueryRowV2(queryPhotoV1());
	assert.deepEqual(indexedDB.records('metadata-query', 'photoQueryRowsV2'), [row]);
	assert.deepEqual(indexedDB.records('metadata-query', 'photoQueryBuildStatesV2'), [state(1, true)]);
	await assert.rejects(catalogTransaction(database, ['photoQueryRowsV2', 'photoQueryBuildStatesV2'], 'readwrite', stores => publishPhotoQueryRowV2(stores, row, 'insert')), /existing|already/iu);
	await catalogTransaction(database, ['photoQueryRowsV2'], 'readwrite', async stores => { await request(stores.photoQueryRowsV2.delete(row.key)); });
	await assert.rejects(repository.savePhoto({ ...queryPhotoV1(), rating: 5 }, 0), /missing/iu);
	assert.equal((await repository.loadPhoto('catalog', row.photoId))!.revision, 0); await repository.close();
});

test('V2 row without build state refuses replacement/rebuild instead of silently resetting its count', async () => {
	for (const mode of ['replace', 'rebuild'] as const) {
		const { indexedDB, database, repository } = await opened(), row = projectPhotoQueryRowV2(queryPhotoV1());
		indexedDB.seedRecord('metadata-query', 'photoQueryRowsV2', row);
		await assert.rejects(catalogTransaction(database, ['photoQueryRowsV2', 'photoQueryBuildStatesV2'], 'readwrite', stores => publishPhotoQueryRowV2(stores, row, mode)), /build state/iu);
		assert.deepEqual(indexedDB.records('metadata-query', 'photoQueryRowsV2'), [row]); await repository.close();
	}
});

test('missing V2 build state refuses an orphan row elsewhere in the same scope with one key probe', async () => {
	const { indexedDB, database, repository } = await opened();
	indexedDB.seedRecord('metadata-query', 'photoQueryRowsV2', projectPhotoQueryRowV2(queryPhotoV1()));
	await assert.rejects(catalogTransaction(database, ['photoQueryRowsV2', 'photoQueryBuildStatesV2'], 'readwrite', stores => publishPhotoQueryRowV2(stores, projectPhotoQueryRowV2(queryPhotoV1(1)), 'insert')), /build state/iu);
	assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryRowsV2'), 1);
	assert.equal(indexedDB.stats.getAllRequests.length, 0); assert.equal(indexedDB.stats.countRequests.length, 0); await repository.close();
});

test('asynchronous V1 budget-shaped failures and invalid legacy build states remain atomic failures', async () => {
	const { indexedDB, repository } = await opened(); await repository.createCatalog(queryCatalogRootV1());
	await repository.publishPhotos('catalog', 0, [queryPhotoV1()]);
	const failure = new RangeError('Photo query row exceeds its byte budget.');
	indexedDB.failNextPutForStore('photoQueryRows', failure);
	await assert.rejects(repository.savePhoto({ ...queryPhotoV1(), rating: 5 }, 0), error => error === failure);
	assert.equal((await repository.loadPhoto('catalog', queryPhotoV1().id))!.rating, 0);
	assert.equal((indexedDB.records('metadata-query', 'photoQueryBuildStates')[0] as { ready: boolean }).ready, true);
	indexedDB.seedRecord('metadata-query', 'photoQueryBuildStates', { id: 'catalog', schemaVersion: 3, ready: true, afterKey: null, indexedCount: 1 });
	await assert.rejects(repository.savePhoto({ ...queryPhotoV1(), rating: 5 }, 0), /future/iu);
	assert.equal((await repository.loadPhoto('catalog', queryPhotoV1().id))!.revision, 0);
	assert.equal((indexedDB.records('metadata-query', 'photoQueryRowsV2')[0] as { rating: number }).rating, 0); await repository.close();
});

test('legal maximal escaped photo publishes through V2, pauses V1, and shrinking restores bounded V1 readiness', async () => {
	const { indexedDB, repository } = await opened(), photo = maximalPhoto(); await repository.createCatalog(maximalRoot());
	await repository.publishPhotos('catalog', 0, [photo]);
	const stored = (await repository.loadPhoto('catalog', photo.id))!, row = indexedDB.records('metadata-query', 'photoQueryRowsV2')[0];
	assert.deepEqual(row, projectPhotoQueryRowV2(stored)); assert.ok(encodedBytes(row) > 524_288);
	assert.equal((await repository.readQueryPageV2('catalog')).items[0]!.photoId, photo.id);
	await assert.rejects(repository.readQueryPage('catalog'), { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
	assert.deepEqual(indexedDB.records('metadata-query', 'photoQueryBuildStates'), [{ id: 'catalog', schemaVersion: 1, ready: false, afterKey: null, indexedCount: 0 }]);
	const shrunk = await repository.savePhoto({ ...stored, metadata: { ...stored.metadata, title: '', caption: '', creator: '', copyright: '', location: '' } }, 0);
	assert.deepEqual(shrunk.original, photo.original); assert.deepEqual(shrunk.extractedMetadata, photo.extractedMetadata);
	assert.equal((await repository.rebuildQueryIndexPage('catalog')).ready, true);
	assert.equal((await repository.readQueryPage('catalog')).items[0]!.photoRevision, 1); await repository.close();
});

test('legacy overflow retains existing rows/count while other V1 failures and V2 failures roll back all photo indexes', async () => {
	const { indexedDB, repository } = await opened(); await repository.createCatalog(maximalRoot());
	const base = maximalPhoto(), small = { ...base, metadata: { ...base.metadata, title: '', caption: '', creator: '', copyright: '', location: '' } };
	await repository.publishPhotos('catalog', 0, [small]); const previousV1 = indexedDB.records('metadata-query', 'photoQueryRows');
	await repository.savePhoto(base, 0);
	assert.deepEqual(indexedDB.records('metadata-query', 'photoQueryRows'), previousV1);
	assert.equal((indexedDB.records('metadata-query', 'photoQueryBuildStates')[0] as { indexedCount: number }).indexedCount, 1);
	for (const store of ['photoQueryRows', 'photoQueryRowsV2', 'photoQueryBuildStatesV2']) {
		const current = (await repository.loadPhoto('catalog', base.id))!, before = ['catalogs', 'photos', 'summaries', 'memberships', 'catalogStates', 'photoQueryRows', 'photoQueryRowsV2', 'photoQueryBuildStates', 'photoQueryBuildStatesV2'].map(name => indexedDB.records('metadata-query', name));
		indexedDB.failNextPutForStore(store, new Error(`${store} write failed`));
		// A missing V2 build row write is reached with an inserted photo; existing-row writes do not update its count.
		if (store === 'photoQueryBuildStatesV2') await assert.rejects(repository.publishPhotos('catalog', 1, [{ ...small, id: 'new-photo' }]), /write failed/u);
		else await assert.rejects(repository.savePhoto({ ...current, metadata: small.metadata }, current.revision), /write failed/u);
		assert.deepEqual(['catalogs', 'photos', 'summaries', 'memberships', 'catalogStates', 'photoQueryRows', 'photoQueryRowsV2', 'photoQueryBuildStates', 'photoQueryBuildStatesV2'].map(name => indexedDB.records('metadata-query', name)), before);
	}
	await repository.close();
});

test('V2 rebuild resumes after reopen and updates already-indexed and inserted rows behind the cursor atomically', async () => {
	const { indexedDB, database, repository, create } = await legacy(); const before = indexedDB.records('metadata-query', 'photos');
	await assert.rejects(repository.readQueryPageV2('catalog'), { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
	assert.equal((await rebuildPhotoQueryIndexPageV2(database, 'catalog')).processed, 16); await repository.close();
	const resumed = create(), first = (await resumed.loadPhoto('catalog', queryPhotoV1().id))!;
	await resumed.savePhoto({ ...first, rating: 5, metadata: { ...first.metadata, cameraMake: 'Current' } }, first.revision);
	const extra = { ...queryPhotoV1(99), id: 'photo-000001-added' }; await resumed.publishPhotos('catalog', 1, [extra]);
	let ready = false; while (!ready) ready = (await resumed.rebuildQueryIndexPageV2('catalog')).ready;
	assert.equal((await resumed.readQueryPageV2('catalog')).items.length, 44);
	assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryRowsV2'), 44);
	assert.equal((indexedDB.records('metadata-query', 'photoQueryRowsV2')[0] as { cameraMake: string }).cameraMake, 'Current');
	assert.deepEqual(await resumed.rebuildQueryIndexPageV2('catalog'), { processed: 0, bytes: 0, derivedBytes: 0, ready: true });
	assert.deepEqual((await resumed.loadPhoto('catalog', queryPhotoV1(2).id)), (before[2] as { document: PhotoDocumentV1 }).document);
	assert.equal(indexedDB.stats.getAllRequests.length, 0); assert.equal(indexedDB.stats.countRequests.length, 0); await resumed.close();
});

test('combined source and Row2 bytes stop before overflow, with one cursor source and <=16 publications per step', async () => {
	const photos = Array.from({ length: 8 }, (_, index) => maximalPhoto(index));
	const { indexedDB, database, repository } = await legacy(photos);
	const sourceSizes = photos.map(photo => new TextEncoder().encode(serializeLightscaperDocumentV1(photo)).byteLength);
	const derivedSizes = photos.map(photo => encodedBytes(projectPhotoQueryRowV2(photo)));
	let expected = 0, sourceBytes = 0, derivedBytes = 0;
	while (sourceBytes + derivedBytes + sourceSizes[expected]! + derivedSizes[expected]! <= 8_388_608) {
		sourceBytes += sourceSizes[expected]!; derivedBytes += derivedSizes[expected]!; expected++;
	}
	assert.ok(expected < 8);
	const first = await rebuildPhotoQueryIndexPageV2(database, 'catalog');
	assert.equal(first.processed, expected); assert.equal(first.ready, false);
	assert.equal(first.bytes, sourceBytes); assert.equal(first.derivedBytes, derivedBytes);
	assert.ok(first.bytes + first.derivedBytes <= 8_388_608); assert.ok(first.bytes + first.derivedBytes + sourceSizes[expected]! + derivedSizes[expected]! > 8_388_608);
	assert.ok(indexedDB.stats.cursorRequests.every((entry: { delivered: number }) => entry.delivered <= 17));
	let ready = false; while (!ready) ready = (await repository.rebuildQueryIndexPageV2('catalog')).ready;
	assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryRowsV2'), 8); await repository.close();
});

test('V2 rebuild row/progress faults and native cancellation roll back progress and join active transactions', async () => {
	const { indexedDB, database, repository } = await legacy(); await rebuildPhotoQueryIndexPageV2(database, 'catalog');
	const before = indexedDB.records('metadata-query', 'photoQueryBuildStatesV2');
	for (const store of ['photoQueryRowsV2', 'photoQueryBuildStatesV2']) {
		indexedDB.failNextPutForStore(store, new Error('rebuild write failed'));
		await assert.rejects(rebuildPhotoQueryIndexPageV2(database, 'catalog'), /rebuild write failed/u);
		assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryRowsV2'), 16);
		assert.deepEqual(indexedDB.records('metadata-query', 'photoQueryBuildStatesV2'), before);
	}
	const cancel = new AbortController(), reason = Object.freeze({ opaque: 'cancelled' });
	indexedDB.onNextGetForStore('photoQueryBuildStatesV2', () => cancel.abort(reason));
	let rejected = false, failure: unknown;
	try { await rebuildPhotoQueryIndexPageV2(database, 'catalog', cancel.signal); }
	catch (error) { rejected = true; failure = error; }
	assert.equal(rejected, true); assert.equal(failure, reason);
	assert.equal(indexedDB.stats.activeTransactions, 0); assert.deepEqual(indexedDB.records('metadata-query', 'photoQueryBuildStatesV2'), before);
	assert.equal((await rebuildPhotoQueryIndexPageV2(database, 'catalog')).processed, 16); await repository.close();
});

test('V2 rebuild refuses forged source key/root count and foreign/future progress without claiming readiness', async () => {
	for (const corruption of ['source', 'count', 'progress'] as const) {
		const { indexedDB, database, repository } = await legacy([queryPhotoV1()]);
		if (corruption === 'source') indexedDB.seedRecord('metadata-query', 'photos', { key: 'catalog|photo-000000', document: { ...queryPhotoV1(), id: 'foreign-photo' } });
		if (corruption === 'count') {
			const root = { ...queryCatalogRootV1(), revision: 1, photoCount: 2 };
			indexedDB.seedRecord('metadata-query', 'catalogs', root); indexedDB.seedRecord('metadata-query', 'catalogStates', indexState(root, 1));
		}
		if (corruption === 'progress') indexedDB.seedRecord('metadata-query', 'photoQueryBuildStatesV2', { ...state(), afterKey: 'foreign|photo' });
		await assert.rejects(rebuildPhotoQueryIndexPageV2(database, 'catalog'));
		assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryRowsV2'), 0); await repository.close();
	}
});

test('rebuild admits canonical 2MiB aggregates before projection and refuses overstated ready counts', async () => {
	for (const corruption of ['root-bytes', 'photo-bytes', 'ready-count'] as const) {
		const { indexedDB, database, repository } = await legacy([queryPhotoV1()]);
		if (corruption === 'root-bytes') {
			const root = { ...queryCatalogRootV1(), revision: 1, photoCount: 1,
				keywords: Array.from({ length: 10_000 }, (_, index) => ({ id: `keyword-${index}`, name: 'x'.repeat(256), parentId: null })) };
			root.keywords[0] = { ...root.keywords[0]!, id: 'keyword' };
			indexedDB.seedRecord('metadata-query', 'catalogs', root);
		}
		if (corruption === 'photo-bytes') {
			const base = maximalPhoto(), effects = Array.from({ length: 96 }, (_, index) => ({ id: `effect-${index}-${'x'.repeat(100)}`, type: 'color-adjust', enabled: true, params: {} }));
			const versions = Array.from({ length: 64 }, (_, index) => ({ ...base.versions[0]!, id: `version-${index}`,
				kind: index === 0 ? 'master' : 'virtual-copy', develop: { ...defaultPhotoDevelopV1(), effects } }));
			const document = normalizePhotoDocumentV1({ ...base, activeVersionId: 'version-0', versions });
			assert.ok(encodedBytes(document) > 2_097_152);
			indexedDB.seedRecord('metadata-query', 'photos', { key: `catalog|${document.id}`, document });
		}
		if (corruption === 'ready-count') indexedDB.seedRecord('metadata-query', 'photoQueryBuildStatesV2', state(0, true));
		await assert.rejects(rebuildPhotoQueryIndexPageV2(database, 'catalog'), corruption === 'ready-count' ? /count/iu : /byte budget/iu);
		assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryRowsV2'), 0);
		assert.equal(indexedDB.stats.activeTransactions, 0); await repository.close();
	}
});

test('exactly16 sources require a truthful bounded trailing empty rebuild step', async () => {
	const { indexedDB, database, repository } = await legacy(Array.from({ length: 16 }, (_, index) => queryPhotoV1(index)));
	const first = await rebuildPhotoQueryIndexPageV2(database, 'catalog');
	assert.equal(first.processed, 16); assert.equal(first.ready, false);
	assert.deepEqual(await rebuildPhotoQueryIndexPageV2(database, 'catalog'), { processed: 0, bytes: 0, derivedBytes: 0, ready: true });
	assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryRowsV2'), 16); await repository.close();
});

test('cancellation after one row/count publication rolls back the whole step and retains exact opaque reason', async () => {
	const { indexedDB, database, repository } = await legacy([queryPhotoV1(), queryPhotoV1(1)]);
	const cancel = new AbortController(), reason = new Proxy({}, { get() { throw new Error('Opaque cancellation inspected.'); } });
	let rowsBeforeAbort = 0, countBeforeAbort = 0;
	indexedDB.onNextGetForStore('photoQueryBuildStatesV2', () => {
		indexedDB.onNextGetForStore('photoQueryBuildStatesV2', () => {
			indexedDB.onNextGetForStore('photoQueryBuildStatesV2', () => {
				rowsBeforeAbort = indexedDB.recordCount('metadata-query', 'photoQueryRowsV2');
				countBeforeAbort = (indexedDB.records('metadata-query', 'photoQueryBuildStatesV2')[0] as { indexedCount: number }).indexedCount;
				cancel.abort(reason);
			});
		});
	});
	let rejected = false, failure: unknown;
	try { await rebuildPhotoQueryIndexPageV2(database, 'catalog', cancel.signal); }
	catch (error) { rejected = true; failure = error; }
	assert.equal(rejected, true); assert.equal(failure, reason);
	assert.equal(rowsBeforeAbort, 1); assert.equal(countBeforeAbort, 1);
	assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryRowsV2'), 0);
	assert.equal(indexedDB.recordCount('metadata-query', 'photoQueryBuildStatesV2'), 0);
	assert.equal(indexedDB.stats.activeTransactions, 0);
	assert.equal((await rebuildPhotoQueryIndexPageV2(database, 'catalog')).ready, true); await repository.close();
});
