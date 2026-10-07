/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });

const ROOT = '/__lightscaper_catalog_repository__';

async function routeRepository(page) {
	const bundle = await build({
		stdin: {
			contents: `export { PhotoCatalogRepositoryV1 } from './src/lightscaper/catalog/repository.ts';
export { defaultPhotoDevelopV1 } from './src/lightscaper/catalog/develop-state.ts';
export { emptyPhotoMetadataV1 } from './src/lightscaper/catalog/photo-metadata.ts';
export { photoSummary, photoMemberships, indexState } from './src/lightscaper/catalog/repository-records.ts';
export function catalog() { return { schemaFamily: 'lightscaper', schemaVersion: 1,
kind: 'photo-catalog', id: 'catalog', name: 'Browser', revision: 0, photoCount: 0,
folders: [], keywords: [], collections: [] }; }
import { defaultPhotoDevelopV1 } from './src/lightscaper/catalog/develop-state.ts';
import { emptyPhotoMetadataV1 } from './src/lightscaper/catalog/photo-metadata.ts';
export function photo(index = 0) { const id = 'photo-' + String(index).padStart(6, '0');
return { schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo', id, catalogId: 'catalog', revision: 0,
original: { schemaVersion: 1, kind: 'still', id: 'source-' + index, name: id + '.jpg', mimeType: 'image/jpeg',
storageKey: 'original-' + index, contentSha256: 'a'.repeat(64), width: 100, height: 100, hasAlpha: false,
byteLength: 123, retention: 'managed' }, metadata: emptyPhotoMetadataV1(id + '.jpg'),
folderId: null, collectionIds: [], keywordIds: [], rating: 0, flag: 'unflagged', colorLabel: 'none',
activeVersionId: 'master', versions: [{ id: 'master', kind: 'master', name: 'Original',
createdAt: '2026-01-01T00:00:00.000Z', develop: defaultPhotoDevelopV1() }] }; }`,
			resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
		},
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'],
	});
	await page.route(`${ROOT}/**`, async (route) => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript',
			body: html ? '<!doctype html><title>Catalog repository qualification</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
}

test('native IndexedDB serializes independent catalog and photo CAS writers', async ({ page }) => {
	await routeRepository(page);
	const result = await page.evaluate(async (root) => {
		const { PhotoCatalogRepositoryV1, catalog, photo } = await import(`${root}/entry.js`);
		const databaseName = 'lightscaper-native-cas';
		const options = { indexedDB, databaseName, verifyOriginal: async () => undefined };
		const first = new PhotoCatalogRepositoryV1(options);
		const second = new PhotoCatalogRepositoryV1(options);
		try {
			await first.createCatalog(catalog());
			await first.publishPhotos('catalog', 0, [photo()]);
			await second.loadCatalog('catalog');
			const edits = await Promise.allSettled([
				first.savePhoto({ ...photo(), rating: 4 }, 0),
				second.savePhoto({ ...photo(), rating: 5 }, 0),
			]);
			const imports = await Promise.allSettled([
				first.publishPhotos('catalog', 1, [photo(1)]),
				second.publishPhotos('catalog', 1, [photo(2)]),
			]);
			const edited = await first.loadPhoto('catalog', photo().id);
			const summary = await second.readSummaryPage('catalog');
			const catalogRoot = await first.loadCatalog('catalog');
			await first.close();
			const reopened = new PhotoCatalogRepositoryV1(options);
			const durable = await reopened.loadPhoto('catalog', photo().id);
			await reopened.close();
			return { edits: edits.map((entry) => entry.status === 'fulfilled'
				? { status: entry.status, revision: entry.value.revision, rating: entry.value.rating }
				: { status: entry.status, code: entry.reason.code }),
			imports: imports.map((entry) => entry.status === 'fulfilled'
				? { status: entry.status, revision: entry.value.revision }
				: { status: entry.status, code: entry.reason.code }),
			photoRevision: edited.revision, rating: edited.rating, durable,
			summaryRating: summary.items.find((item) => item.photoId === photo().id).rating,
			count: catalogRoot.photoCount, rootRevision: catalogRoot.revision };
		} finally { await first.close(); await second.close(); }
	}, ROOT);
	expect(result.edits.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
	expect(result.edits.filter((entry) => entry.status === 'rejected')).toEqual([{ status: 'rejected', code: 'PHOTO_REVISION_CONFLICT' }]);
	expect(result.imports.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
	expect(result.imports.filter((entry) => entry.status === 'rejected')).toEqual([{ status: 'rejected', code: 'CATALOG_REVISION_CONFLICT' }]);
	expect(result.photoRevision).toBe(1);
	expect(result.durable.rating).toBe(result.rating);
	expect(result.summaryRating).toBe(result.rating);
	expect(result.count).toBe(2);
	expect(result.rootRevision).toBe(2);
});

test('native version changes close catalog owners and future databases refuse v1 reopening', async ({ page }) => {
	await routeRepository(page);
	const result = await page.evaluate(async (root) => {
		const { PhotoCatalogRepositoryV1, catalog } = await import(`${root}/entry.js`);
		const databaseName = 'lightscaper-native-future-version';
		const options = { indexedDB, databaseName, verifyOriginal: async () => undefined };
		const repository = new PhotoCatalogRepositoryV1(options);
		await repository.createCatalog(catalog());
		const stores = await new Promise((resolve, reject) => {
			const open = indexedDB.open(databaseName, 2);
			open.onsuccess = () => { resolve([...open.result.objectStoreNames]); open.result.close(); };
			open.onerror = () => reject(open.error);
			open.onblocked = () => reject(new Error('The catalog owner retained its connection during version change.'));
		});
		let closedCode;
		try { await repository.loadCatalog('catalog'); } catch (error) { closedCode = error.code; }
		await repository.close();
		const next = new PhotoCatalogRepositoryV1(options);
		let futureError;
		try { await next.loadCatalog('catalog'); } catch (error) { futureError = error.name; }
		await next.close();
		return { stores, closedCode, futureError };
	}, ROOT);
	expect(result.stores).toEqual(['catalogStates', 'catalogs', 'memberships', 'photos', 'summaries']);
	expect(result.closedCode).toBe('CATALOG_CLOSED');
	expect(result.futureError).toBe('VersionError');
});

test('native indexes bound distant 100,000-photo pages without retaining transactions or loading aggregates', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The six-figure physical index fixture is qualified once; CAS scheduling is checked in every engine.');
	test.setTimeout(180_000);
	await routeRepository(page);
	const result = await page.evaluate(async (root) => {
		const { PhotoCatalogRepositoryV1, catalog, photo, photoSummary, photoMemberships, indexState } = await import(`${root}/entry.js`);
		const databaseName = 'lightscaper-native-paging';
		const repository = new PhotoCatalogRepositoryV1({ indexedDB, databaseName, verifyOriginal: async () => undefined });
		await repository.createCatalog(catalog());
		const database = await new Promise((resolve, reject) => {
			const open = indexedDB.open(databaseName, 1);
			open.onsuccess = () => resolve(open.result);
			open.onerror = () => reject(open.error);
		});
		// Seed the physical indexes and all per-photo aggregates directly; admission
		// batches are qualified separately and would mask the cursor cost measured here.
		for (let start = 0; start < 100_000; start += 1_000) {
			await new Promise((resolve, reject) => {
				const transaction = database.transaction(['photos', 'summaries', 'memberships'], 'readwrite');
				transaction.oncomplete = resolve;
				transaction.onabort = () => reject(transaction.error);
				for (let index = start; index < start + 1_000; index++) {
					const item = photo(index);
					transaction.objectStore('photos').put({ key: `catalog|${item.id}`, document: item });
					transaction.objectStore('summaries').put(photoSummary(item));
					const membership = photoMemberships(item).find((entry) => entry.scope === 'catalog|rating|0');
					transaction.objectStore('memberships').put(membership);
				}
			});
		}
		await new Promise((resolve, reject) => {
			const transaction = database.transaction(['catalogs', 'catalogStates'], 'readwrite');
			transaction.oncomplete = resolve;
			transaction.onabort = () => reject(transaction.error);
			const large = { ...catalog(), revision: 1, photoCount: 100_000 };
			transaction.objectStore('catalogs').put(large);
			transaction.objectStore('catalogStates').put(indexState(large, 1));
		});
		database.close();
		const original = { transaction: IDBDatabase.prototype.transaction, cursor: IDBIndex.prototype.openCursor,
			get: IDBObjectStore.prototype.get, getAll: IDBObjectStore.prototype.getAll };
		const cursors = [];
		const gets = [];
		let active = 0;
		IDBDatabase.prototype.transaction = function (...args) {
			const transaction = original.transaction.apply(this, args);
			active++;
			const complete = () => { active--; };
			transaction.addEventListener('complete', complete, { once: true });
			transaction.addEventListener('abort', complete, { once: true });
			return transaction;
		};
		IDBIndex.prototype.openCursor = function (...args) {
			const cursor = original.cursor.apply(this, args);
			const count = { delivered: 0 };
			cursors.push(count);
			cursor.addEventListener('success', () => { count.delivered++; });
			return cursor;
		};
		IDBObjectStore.prototype.get = function (...args) { gets.push(this.name); return original.get.apply(this, args); };
		IDBObjectStore.prototype.getAll = function () { throw new Error('Full catalog materialization is forbidden.'); };
		try {
			const first = await repository.readSummaryPage('catalog');
			const distant = await repository.readSummaryPage('catalog', { continuation: {
				...first.continuation, afterKey: 'catalog|photo-095000',
			} });
			const filtered = await repository.readSummaryPage('catalog', { filter: { kind: 'rating', value: 0 }, continuation: {
				catalogId: 'catalog', indexRevision: 1, scope: 'catalog|rating|0', afterKey: 'catalog|rating|0|photo-095000',
			} });
			return { counts: [first.items.length, distant.items.length, filtered.items.length],
				first: first.items[0].photoId, distant: distant.items[0].photoId, filtered: filtered.items[0].photoId,
				active, cursors, gets };
		} finally {
			IDBDatabase.prototype.transaction = original.transaction;
			IDBIndex.prototype.openCursor = original.cursor;
			IDBObjectStore.prototype.get = original.get;
			IDBObjectStore.prototype.getAll = original.getAll;
			await repository.close();
		}
	}, ROOT);
	expect(result.counts).toEqual([64, 64, 64]);
	expect(result.first).toBe('photo-000000');
	expect(result.distant).toBe('photo-095001');
	expect(result.filtered).toBe('photo-095001');
	expect(result.cursors).toHaveLength(3);
	expect(result.cursors.every((cursor) => cursor.delivered <= 66)).toBe(true);
	expect(result.gets).not.toContain('photos');
	expect(result.gets).not.toContain('catalogs');
	expect(result.active).toBe(0);
});
