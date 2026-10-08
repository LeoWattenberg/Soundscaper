/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__catalog_original_repair__';

async function routeRepair(page) {
	const bundle = await build({
		stdin: { contents: `
export { openDatabase } from './src/common/editor/storage/indexeddb-backend.ts';
export { getMemoryDatabase } from './src/common/editor/storage/memory-backend.ts';
export { MediaRepository } from './src/common/editor/storage/media-repository.ts';
export { OpfsRepository } from './src/common/editor/storage/opfs-repository.ts';`,
		resolveDir: fileURLToPath(new URL('../..', import.meta.url)) },
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'],
	});
	await page.route(`${ROOT}/**`, async route => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript',
			body: html ? '<!doctype html><title>Exact original repair qualification</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
}

test('native repair pages all retained roots, publishes and completes its lease in one transaction', async ({ page }) => {
	await routeRepair(page);
	const result = await page.evaluate(async root => {
		const api = await import(`${root}/entry.js`);
		const name = 'original-repair-native-atomic';
		const firstDatabase = await api.openDatabase(indexedDB, name);
		const secondDatabase = await api.openDatabase(indexedDB, name);
		const create = database => new api.MediaRepository({ memory: api.getMemoryDatabase(name), database: async () => database },
			new api.OpfsRepository({ preferOpfs: false }));
		const first = create(firstDatabase), second = create(secondDatabase);
		const body = new Blob(['exact retained original']);
		const metadata = await first.writeAsset('shared-original', body, { name: 'camera.png', mimeType: 'image/png' });
		const references = Array.from({ length: 129 }, (_, index) => ({ photoId: 'photo-' + String(index).padStart(3, '0'),
			assetId: 'shared-original', sourceId: 'logical-' + index, sha256: metadata.sha256, size: metadata.size }));
		for (let start = 0; start < references.length; start += 16) {
			await first.catalogOriginals.stage('catalog', 'import', references.slice(start, start + 16));
		}
		await new Promise((resolve, reject) => {
			const transaction = firstDatabase.transaction('mediaAssets', 'readwrite');
			transaction.objectStore('mediaAssets').delete('shared-original');
			transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
		});
		const originalTransaction = IDBDatabase.prototype.transaction;
		const originalCursor = IDBIndex.prototype.openCursor;
		const originalPut = IDBObjectStore.prototype.put;
		const originalDelete = IDBObjectStore.prototype.delete;
		const originalGet = IDBObjectStore.prototype.get;
		const witnessed = new Set();
		let publication, publicationCount = 0, settled = false, cursors = 0, puts = 0, completions = 0;
		let competing, competingRequestedBeforeSettlement = false, competingReadBeforeSettlement = false;
		IDBDatabase.prototype.transaction = function (...args) {
			const transaction = originalTransaction.apply(this, args);
			if (this === firstDatabase && transaction.mode === 'readwrite'
				&& ['mediaAssets', 'catalogOriginalRoots', 'mediaAssetStaging'].every(store => transaction.objectStoreNames.contains(store))) {
				publication = transaction; publicationCount++;
				transaction.addEventListener('complete', () => { settled = true; }, { once: true });
			}
			return transaction;
		};
		IDBIndex.prototype.openCursor = function (...args) {
			const request = originalCursor.apply(this, args);
			if (this.name === 'assetId' && this.objectStore.transaction === publication) {
				cursors++; witnessed.add(this.objectStore.transaction);
				request.addEventListener('success', () => {
					if (!competing && request.result) {
						competingRequestedBeforeSettlement = !settled;
						competing = second.catalogOriginals.retain('other-catalog', [{ ...references[0], photoId: 'other-photo', sourceId: 'other-logical' }]);
					}
				});
			}
			return request;
		};
		IDBObjectStore.prototype.put = function (...args) {
			if (this.name === 'mediaAssets' && this.transaction === publication) { puts++; witnessed.add(this.transaction); }
			return originalPut.apply(this, args);
		};
		IDBObjectStore.prototype.delete = function (...args) {
			if (this.name === 'mediaAssetStaging' && this.transaction === publication) { completions++; witnessed.add(this.transaction); }
			return originalDelete.apply(this, args);
		};
		IDBObjectStore.prototype.get = function (...args) {
			const request = originalGet.apply(this, args);
			if (this.transaction.db === secondDatabase && this.transaction.mode === 'readwrite') {
				request.addEventListener('success', () => { competingReadBeforeSettlement ||= !settled; });
			}
			return request;
		};
		try {
			const receipt = await first.restoreCatalogOriginalBody({ ...references[0], catalogId: 'catalog', importId: 'import',
				name: 'camera.png', mimeType: 'image/png' }, body);
			if (!competing) throw new Error('The competing connection was never admitted.');
			await competing;
			const row = await new Promise((resolve, reject) => {
				const transaction = firstDatabase.transaction('mediaAssets');
				const read = transaction.objectStore('mediaAssets').get('shared-original');
				let value; read.onsuccess = () => { value = read.result; };
				transaction.oncomplete = () => resolve(value); transaction.onabort = () => reject(transaction.error);
			});
			const loaded = await first.loadAsset('shared-original');
			return { receipt, cursors, puts, completions, publicationCount, sameTransaction: witnessed.size === 1 && witnessed.has(publication),
				settled, competingRequestedBeforeSettlement, competingReadBeforeSettlement, rootCount: row.catalogRootCount,
				body: await loaded.text(), retained: (await first.catalogOriginals.readPage({ catalogId: 'catalog', importId: 'import' })).roots.length };
		} finally {
			IDBDatabase.prototype.transaction = originalTransaction; IDBIndex.prototype.openCursor = originalCursor;
			IDBObjectStore.prototype.put = originalPut; IDBObjectStore.prototype.delete = originalDelete; IDBObjectStore.prototype.get = originalGet;
			firstDatabase.close(); secondDatabase.close();
		}
	}, ROOT);
	expect(result.publicationCount).toBe(1);
	expect(result.cursors).toBe(3);
	expect(result.puts).toBe(1);
	expect(result.completions).toBe(1);
	expect(result.sameTransaction).toBe(true);
	expect(result.settled).toBe(true);
	expect(result.competingRequestedBeforeSettlement).toBe(true);
	expect(result.competingReadBeforeSettlement).toBe(false);
	expect(result.rootCount).toBe(130);
	expect(result.retained).toBe(64);
	expect(result.receipt.assetId).toBe('shared-original');
	expect(result.body).toBe('exact retained original');
});

test('native repair refuses a divergent root beyond page one acquired after the initial capture', async ({ page }) => {
	await routeRepair(page);
	const result = await page.evaluate(async root => {
		const api = await import(`${root}/entry.js`);
		const name = 'original-repair-native-late-conflict';
		const database = await api.openDatabase(indexedDB, name);
		const other = await api.openDatabase(indexedDB, name);
		const media = new api.MediaRepository({ memory: api.getMemoryDatabase(name), database: async () => database },
			new api.OpfsRepository({ preferOpfs: false }));
		const body = new Blob(['exact retained original']);
		const metadata = await media.writeAsset('original', body);
		const references = Array.from({ length: 129 }, (_, index) => ({ photoId: 'photo-' + String(index).padStart(3, '0'),
			assetId: 'original', sourceId: 'logical-' + index, sha256: metadata.sha256, size: metadata.size }));
		for (let start = 0; start < references.length; start += 16) await media.catalogOriginals.retain('catalog', references.slice(start, start + 16));
		const read = (store, key) => new Promise((resolve, reject) => {
			const transaction = database.transaction(store);
			const request = transaction.objectStore(store).get(key);
			let value; request.onsuccess = () => { value = request.result; };
			transaction.oncomplete = () => resolve(value); transaction.onabort = () => reject(transaction.error);
		});
		const originalRow = await read('mediaAssets', 'original');
		const badKey = JSON.stringify(['catalog', null, 'photo-128']);
		const badRoot = await read('catalogOriginalRoots', badKey);
		const originalArrayBuffer = Blob.prototype.arrayBuffer;
		let bodyReads = 0;
		Blob.prototype.arrayBuffer = async function () {
			if (++bodyReads === 2) {
				await new Promise((resolve, reject) => {
					const transaction = other.transaction('catalogOriginalRoots', 'readwrite');
					transaction.objectStore('catalogOriginalRoots').put({ ...badRoot, mediaContentToken: 'media-content-divergent-0000000000000000' });
					transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
				});
			}
			return originalArrayBuffer.call(this);
		};
		try {
			let error;
			try { await media.restoreCatalogOriginalBody({ ...references[0], catalogId: 'catalog', importId: null, name: 'camera.png', mimeType: 'image/png' }, body); }
			catch (failure) { error = failure.message; }
			const row = await read('mediaAssets', 'original');
			const inventory = await new Promise((resolve, reject) => {
				const transaction = database.transaction(['mediaAssetChunks', 'mediaAssetStaging']);
				const counts = {};
				for (const store of ['mediaAssetChunks', 'mediaAssetStaging']) {
					const request = transaction.objectStore(store).getAll(); request.onsuccess = () => { counts[store] = request.result; };
				}
				transaction.oncomplete = () => resolve(counts); transaction.onabort = () => reject(transaction.error);
			});
			return { error, bodyReads, unchanged: row.mediaContentToken === originalRow.mediaContentToken && row.storage === originalRow.storage,
				count: row.catalogRootCount, chunks: inventory.mediaAssetChunks.length,
				leases: inventory.mediaAssetStaging.filter(value => value.kind === 'lease').length,
				body: await (await media.loadAsset('original')).text(), divergentRootRetained: (await read('catalogOriginalRoots', badKey)).mediaContentToken !== badRoot.mediaContentToken };
		} finally { Blob.prototype.arrayBuffer = originalArrayBuffer; database.close(); other.close(); }
	}, ROOT);
	expect(result.error).toContain('root identity is inconsistent');
	expect(result.bodyReads).toBe(2);
	expect(result.unchanged).toBe(true);
	expect(result.count).toBe(129);
	expect(result.chunks).toBe(0);
	expect(result.leases).toBe(0);
	expect(result.divergentRootRetained).toBe(true);
	expect(result.body).toBe('exact retained original');
});
