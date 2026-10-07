/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { PHOTO_CATALOG_DATABASE_VERSION } from '../../src/lightscaper/catalog/repository-types.ts';
import { indexState, photoSummary } from '../../src/lightscaper/catalog/repository-records.ts';
import { normalizePhotoCatalogQueryV1, type PhotoQueryContinuationV1 } from '../../src/lightscaper/catalog/photo-query-types-v1.ts';
import { queryCatalogRootV1, queryPhotoV1, queryScaleFixtureRowV1 } from './lightscaper-catalog-query-fixture.ts';

function open(name: string, version = PHOTO_CATALOG_DATABASE_VERSION): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open(name, version);
		opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
	});
}
function write(database: IDBDatabase, names: string[], work: (transaction: IDBTransaction) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(names, 'readwrite');
		transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
		work(transaction);
	});
}
function repository(name: string) {
	return new PhotoCatalogRepositoryV1({ indexedDB, databaseName: name, verifyOriginal: async () => undefined });
}

export async function qualifyCatalogQueryScaleNativeV1() {
	const name = 'lightscaper-query-scale-v1'; const owner = repository(name);
	await owner.createCatalog(queryCatalogRootV1()); const database = await open(name);
	const seedStarted = performance.now();
	for (let start = 0; start < 100_000; start += 1_000) {
		await write(database, ['photoQueryRows'], (transaction) => {
			for (let index = start; index < Math.min(100_000, start + 1_000); index++) transaction.objectStore('photoQueryRows').put(queryScaleFixtureRowV1(index));
		});
		if (start % 20_000 === 0) console.info('catalog-query-measurement', JSON.stringify({ phase: 'seed', rows: start + 1_000, milliseconds: performance.now() - seedStarted }));
	}
	await write(database, ['catalogs', 'catalogStates', 'photoQueryBuildStates'], (transaction) => {
		const root = { ...queryCatalogRootV1(), revision: 1, photoCount: 100_000 };
		transaction.objectStore('catalogs').put(root); transaction.objectStore('catalogStates').put(indexState(root, 1));
		transaction.objectStore('photoQueryBuildStates').put({ id: 'catalog', schemaVersion: 1, ready: true, afterKey: null, indexedCount: 100_000 });
	});
	database.close(); const seedMilliseconds = performance.now() - seedStarted;
	console.info('catalog-query-measurement', JSON.stringify({ phase: 'query', seedMilliseconds }));
	const native = { transaction: IDBDatabase.prototype.transaction, cursor: IDBIndex.prototype.openCursor,
		get: IDBObjectStore.prototype.get, getAll: IDBObjectStore.prototype.getAll };
	let active = 0; let maximumCandidates = 0; let forbiddenReads = 0; let emptySteps = 0;
	const timings: number[] = []; const sparseIds: string[] = [];
	IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
		const transaction = native.transaction.apply(this, args); active++;
		const done = () => { active--; };
		transaction.addEventListener('complete', done, { once: true }); transaction.addEventListener('abort', done, { once: true });
		return transaction;
	};
	IDBIndex.prototype.openCursor = function (...args: Parameters<IDBIndex['openCursor']>) {
		const cursor = native.cursor.apply(this, args); let delivered = 0;
		cursor.addEventListener('success', () => { if (cursor.result) { delivered++; maximumCandidates = Math.max(maximumCandidates, delivered); } });
		return cursor;
	};
	IDBObjectStore.prototype.get = function (...args: Parameters<IDBObjectStore['get']>) {
		if (this.name === 'photos') { forbiddenReads++; throw new Error('Query loaded a photo aggregate.'); }
		return native.get.apply(this, args);
	};
	IDBObjectStore.prototype.getAll = function () { forbiddenReads++; throw new Error('Query materialized a store.'); };
	try {
		const query = normalizePhotoCatalogQueryV1({ sort: { field: 'file-name', direction: 'ascending' } });
		const firstStarted = performance.now(); const first = await owner.readQueryPage('catalog', { query }); timings.push(performance.now() - firstStarted);
		const distantStarted = performance.now(); const distant = await owner.readQueryPage('catalog', { query,
			continuation: { ...first.continuation!, afterKey: ['catalog', 'image-095000.jpg', 'photo-005000'] } }); timings.push(performance.now() - distantStarted);
		const sparse = normalizePhotoCatalogQueryV1({ text: 'needle', sort: { field: 'photo-id', direction: 'ascending' } });
		let continuation: PhotoQueryContinuationV1 | null = null;
		do {
			const started = performance.now(); const page = await owner.readQueryPage('catalog', { query: sparse, continuation }); timings.push(performance.now() - started);
			if (page.items.length === 0 && page.continuation) emptySteps++;
			for (const item of page.items) sparseIds.push(item.photoId);
			continuation = page.continuation;
			if (active !== 0) throw new Error('A query retained its transaction between steps.');
		} while (continuation);
		const sorted = timings.slice().sort((a, b) => a - b);
		const result = { first: first.items[0]!.photoId, distant: distant.items[0]!.photoId, sparseIds,
			steps: timings.length, p95Milliseconds: sorted[Math.ceil(sorted.length * 0.95) - 1]!, maximumCandidates,
			emptySteps, forbiddenReads, active, seedMilliseconds, queryMilliseconds: timings.reduce((sum, value) => sum + value, 0) };
		console.info('catalog-query-measurement', JSON.stringify({ ...result, sparseIds: result.sparseIds.length }));
		return result;
	} finally {
		IDBDatabase.prototype.transaction = native.transaction; IDBIndex.prototype.openCursor = native.cursor;
		IDBObjectStore.prototype.get = native.get; IDBObjectStore.prototype.getAll = native.getAll; await owner.close();
	}
}

export async function qualifyCatalogQueryMigrationNativeV1() {
	const name = 'lightscaper-query-migration-v1';
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(name, 1);
		opening.onupgradeneeded = () => {
			for (const name of ['catalogs', 'catalogStates', 'photos', 'summaries', 'memberships']) {
				const store = opening.result.createObjectStore(name, { keyPath: name.startsWith('catalog') ? 'id' : 'key' });
				if (name === 'summaries') store.createIndex('catalogId', 'catalogId'); if (name === 'memberships') store.createIndex('scope', 'scope');
			}
		};
		opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
	});
	await write(database, ['catalogs', 'catalogStates', 'photos', 'summaries'], (transaction) => {
		const root = { ...queryCatalogRootV1(), revision: 1, photoCount: 43 };
		transaction.objectStore('catalogs').put(root); transaction.objectStore('catalogStates').put(indexState(root, 1));
		for (let index = 0; index < 43; index++) {
			const photo = queryPhotoV1(index); transaction.objectStore('photos').put({ key: `catalog|${photo.id}`, document: photo });
			transaction.objectStore('summaries').put(photoSummary(photo));
		}
	});
	database.close(); let owner = repository(name); let refusal = '';
	try { await owner.readQueryPage('catalog'); } catch (error) { refusal = (error as { code: string }).code; }
	const first = await owner.rebuildQueryIndexPage('catalog'); await owner.close(); owner = repository(name);
	try {
		const photo = (await owner.loadPhoto('catalog', queryPhotoV1().id))!;
		await owner.savePhoto({ ...photo, rating: 5 }, photo.revision);
		await owner.publishPhotos('catalog', 1, [{ ...queryPhotoV1(99), id: 'photo-000001-added' }]);
		let ready = false; while (!ready) ready = (await owner.rebuildQueryIndexPage('catalog')).ready;
		const ascending = await owner.readQueryPage('catalog', { query: { sort: { field: 'capture-time', direction: 'ascending' } } });
		const descending = await owner.readQueryPage('catalog', { query: { sort: { field: 'capture-time', direction: 'descending' } } });
		const ids: string[] = []; let continuation: PhotoQueryContinuationV1 | null = null;
		do { const page = await owner.readQueryPage('catalog', { continuation }); ids.push(...page.items.map((item) => item.photoId)); continuation = page.continuation; } while (continuation);
		return { refusal, first, count: ids.length, newPhoto: ids.includes('photo-000001-added'),
			currentRating: (await owner.loadPhoto('catalog', photo.id))!.rating,
			firstCapture: [ascending.items[0]!.captureLocal, descending.items[0]!.captureLocal],
			originalSha256: (await owner.loadPhoto('catalog', photo.id))!.original.contentSha256 };
	} finally { await owner.close(); }
}
