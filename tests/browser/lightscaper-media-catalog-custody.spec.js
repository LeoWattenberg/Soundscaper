/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_media_custody__';

async function routeMedia(page) {
	const bundle = await build({
		stdin: { contents: `
export { openDatabase } from './src/common/editor/storage/indexeddb-backend.ts';
export { getMemoryDatabase } from './src/common/editor/storage/memory-backend.ts';
export { MediaRepository } from './src/common/editor/storage/media-repository.ts';
export { OpfsRepository } from './src/common/editor/storage/opfs-repository.ts';
export { deleteIndexedDbRetentionCandidates } from './src/common/editor/storage/indexeddb-retention-prune.ts';`,
		resolveDir: fileURLToPath(new URL('../..', import.meta.url)) },
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'],
	});
	await page.route(`${ROOT}/**`, async (route) => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript',
			body: html ? '<!doctype html><title>Shared media custody qualification</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
}

test('native catalog root admission and deletion serialize across shared media connections', async ({ page }) => {
	await routeMedia(page);
	const result = await page.evaluate(async (root) => {
		const api = await import(`${root}/entry.js`);
		const name = 'catalog-media-native-races';
		const firstDatabase = await api.openDatabase(indexedDB, name);
		const secondDatabase = await api.openDatabase(indexedDB, name);
		const create = (database) => new api.MediaRepository({ memory: api.getMemoryDatabase(name),
			database: async () => database }, new api.OpfsRepository({ preferOpfs: false }));
		const first = create(firstDatabase);
		const second = create(secondDatabase);
		const writeOriginal = async (assetId, text) => {
			const bytes = new TextEncoder().encode(text);
			const digest = await crypto.subtle.digest('SHA-256', bytes);
			const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
			const writer = await first.beginAssetWrite(assetId, {}, { expectedBytes: bytes.length, expectedSha256: sha256 });
			await writer.write(bytes);
			return writer.commit();
		};
		const outcomes = [];
		for (let index = 0; index < 8; index++) {
			const assetId = `original-${index}`;
			const metadata = await writeOriginal(assetId, 'original camera file');
			const reference = { photoId: assetId, assetId, sourceId: 'logical-source', sha256: metadata.sha256, size: metadata.size };
			const race = await Promise.allSettled([
				first.catalogOriginals.retain('catalog', [reference]), second.deleteAsset(assetId),
			]);
			outcomes.push(race.map(({ status }) => status));
		}
		const original = await writeOriginal('retained-original', 'retained original file');
		await first.catalogOriginals.stage('catalog', 'recoverable-import', [{ photoId: 'retained-photo',
			assetId: 'retained-original', sourceId: 'logical-original', sha256: original.sha256, size: original.size }]);
		firstDatabase.close(); secondDatabase.close();
		const reopenedDatabase = await api.openDatabase(indexedDB, name);
		const reopened = create(reopenedDatabase);
		const recovered = await reopened.catalogOriginals.readPage({ catalogId: 'catalog', importId: 'recoverable-import' });
		let deletion;
		try { await reopened.deleteAsset('retained-original'); deletion = 'unsafe deletion'; } catch (error) { deletion = error.message; }
		const body = await reopened.loadAsset('retained-original');
		await reopened.catalogOriginals.promote('catalog', 'recoverable-import', ['retained-photo']);
		await reopened.catalogOriginals.releaseStaged('catalog', 'recoverable-import', ['retained-photo']);
		const committed = await reopened.catalogOriginals.readPage({ catalogId: 'catalog' });
		reopenedDatabase.close();
		return { outcomes, recovered: recovered.roots.length, deletion,
			body: new TextDecoder().decode(await body.arrayBuffer()),
			promoted: committed.roots.some(({ photoId }) => photoId === 'retained-photo') };
	}, ROOT);
	for (const outcome of result.outcomes) expect(outcome.filter((status) => status === 'fulfilled')).toHaveLength(1);
	expect(result.recovered).toBe(1);
	expect(result.deletion).toContain('catalog original');
	expect(result.body).toBe('retained original file');
	expect(result.promoted).toBe(true);
});

test('native digest and recovery indexes bound distant pages in a 100,000-original catalog', async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The six-figure index fixture runs once; transaction races run in each engine.');
	test.setTimeout(180_000);
	await routeMedia(page);
	const result = await page.evaluate(async (root) => {
		const api = await import(`${root}/entry.js`);
		const name = 'catalog-media-native-100k';
		const database = await api.openDatabase(indexedDB, name);
		const media = new api.MediaRepository({ memory: api.getMemoryDatabase(name), database: async () => database },
			new api.OpfsRepository({ preferOpfs: false }));
		const prototype = await media.writeAsset('prototype', new Blob(['retained original file bytes']));
		let asset;
		await new Promise((resolve, reject) => {
			const transaction = database.transaction('mediaAssets');
			const read = transaction.objectStore('mediaAssets').get('prototype');
			read.onsuccess = () => { asset = read.result; };
			transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
		});
		for (let start = 0; start < 100_000; start += 1_000) {
			await new Promise((resolve, reject) => {
				const transaction = database.transaction(['mediaAssets', 'catalogOriginalRoots'], 'readwrite');
				transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
				for (let index = start; index < start + 1_000; index++) {
					const id = 'asset-' + String(index).padStart(6, '0');
					transaction.objectStore('mediaAssets').put({ ...asset, sourceId: id, catalogRootCount: 1 });
					transaction.objectStore('catalogOriginalRoots').put({ schemaVersion: 1,
						key: JSON.stringify(['catalog', null, id]), scope: JSON.stringify(['catalog', null]),
						catalogId: 'catalog', importId: null, photoId: id, assetId: id, sourceId: 'logical-' + id,
						sha256: prototype.sha256, size: prototype.size, mediaContentToken: asset.mediaContentToken });
				}
			});
		}
		const observations = { getAll: 0, cursorEvents: 0, activeTransactions: 0, maximumPageEvents: 0 };
		const originalGetAll = IDBObjectStore.prototype.getAll;
		const originalCursor = IDBIndex.prototype.openCursor;
		const originalTransaction = IDBDatabase.prototype.transaction;
		IDBObjectStore.prototype.getAll = function (...args) {
			if (this.name === 'mediaAssets' || this.name === 'catalogOriginalRoots') observations.getAll++;
			return originalGetAll.apply(this, args);
		};
		IDBIndex.prototype.openCursor = function (...args) {
			const request = originalCursor.apply(this, args);
			request.addEventListener('success', () => { observations.cursorEvents++; });
			return request;
		};
		IDBDatabase.prototype.transaction = function (...args) {
			const transaction = originalTransaction.apply(this, args);
			observations.activeTransactions++;
			const done = () => observations.activeTransactions--;
			transaction.addEventListener('complete', done, { once: true });
			transaction.addEventListener('abort', done, { once: true });
			return transaction;
		};
		try {
			const digest = await media.catalogOriginals.findDigestPage(prototype.sha256, 'asset-095000');
			observations.maximumPageEvents = observations.cursorEvents;
			observations.cursorEvents = 0;
			const roots = await media.catalogOriginals.readPage({ catalogId: 'catalog', afterKey: JSON.stringify(['catalog', null, 'asset-095000']) });
			observations.maximumPageEvents = Math.max(observations.maximumPageEvents, observations.cursorEvents);
			const state = { protectedIds: new Set(), maximumAge: 0, currentTime: Date.now() + 172_800_000,
				deferredSourceIds: [], getNextEligibleAt: () => null, setNextEligibleAt: () => undefined };
			const pruned = await api.deleteIndexedDbRetentionCandidates(database, undefined, state);
			return { digestLength: digest.matches.length, firstDigest: digest.matches[0].assetId,
				rootLength: roots.roots.length, firstRoot: roots.roots[0].assetId,
				getAll: observations.getAll, pageEvents: observations.maximumPageEvents,
				activeTransactions: observations.activeTransactions, deleted: pruned.removedSourceIds,
				retainedInventory: state.protectedIds.size };
		} finally {
			IDBObjectStore.prototype.getAll = originalGetAll; IDBIndex.prototype.openCursor = originalCursor;
			IDBDatabase.prototype.transaction = originalTransaction; database.close();
		}
	}, ROOT);
	expect(result.digestLength).toBe(64);
	expect(result.firstDigest).toBe('asset-095001');
	expect(result.rootLength).toBe(64);
	expect(result.firstRoot).toBe('asset-095001');
	expect(result.getAll).toBe(0);
	expect(result.pageEvents).toBeLessThanOrEqual(66);
	expect(result.activeTransactions).toBe(0);
	expect(result.deleted).toEqual(['prototype']);
	expect(result.retainedInventory).toBe(0);
});
