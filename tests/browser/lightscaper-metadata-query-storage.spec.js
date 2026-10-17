/* SPDX-License-Identifier: AGPL-3.0-only */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browserProductSiteForBuild } from '../../scripts/lib/browser-product-site-plan.mjs';
import { expect, test } from './helpers/browser-coverage-fixture.js';

// The routed esbuild storage facade is test-only executable code, excluded from portable coverage.
test.use({ browserCoverage: false });

const MODULE = '/__lightscaper_metadata_storage.js';
const ENTRY = `
export {PhotoCatalogRepositoryV1} from './src/lightscaper/catalog/repository.ts';
export {openPhotoCatalogDatabaseV1} from './src/lightscaper/catalog/catalog-database.ts';
export {normalizePhotoDocumentV1} from './src/lightscaper/catalog/photo-document.ts';
export {normalizePhotoCatalogRootV1} from './src/lightscaper/catalog/catalog-root.ts';
export {serializeLightscaperDocumentV1} from './src/lightscaper/catalog/documents.ts';
export {indexState,photoSummary,photoMemberships} from './src/lightscaper/catalog/repository-records.ts';
export {projectPhotoQueryRowV1} from './src/lightscaper/catalog/photo-query-index-v1.ts';
export {projectPhotoQueryRowV2,photoQuerySummaryV2} from './src/lightscaper/catalog/photo-query-index-v2.ts';
export {readPhotoStackQueryPageV2} from './src/lightscaper/catalog/photo-stack-query-v2.ts';
export {queryPhotoV1,queryCatalogRootV1} from './tests/helpers/lightscaper-catalog-query-fixture.ts';
`;

test('native schema3 upgrades preserve legacy bytes and resume explicit16+1 metadata reindex after reopen', async ({ page }) => {
	test.setTimeout(180_000);
	await setup(page);
	const result = await page.evaluate(qualifyStorage, { path: MODULE, mode: 'migration' });
	expect(result).toMatchObject({ oldVersion: 3, version: 5, upgradeRequests: 0, untouchedLegacy: true, missingV2Refused: true,
		oldReady: true, legacyRowsAfterUpgrade: 17, newBuildInitiallyAbsent: true, newRowsInitiallyAbsent: true, first: { processed: 16, ready: false }, second: { processed: 1, ready: true },
		firstBuild: { indexedCount: 16, ready: false }, preservedAfterRebuild: true, forbiddenRequests: 0, activeTransactions: 0 });
	expect(result.inventory).toHaveLength(15);
	expect(result.oldInventory).toEqual(result.inventory.filter(store => !['photoQueryRowsV2', 'photoQueryBuildStatesV2',
		'photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates'].includes(store.name)));
	expect(result.oldInventory.map(store => store.name)).toEqual(['catalogStates', 'catalogs', 'memberships', 'photoQueryBuildStates', 'photoQueryRows',
		'photoStackMemberships', 'photoStackStates', 'photoStacks', 'photos', 'summaries']);
	expect(result.inventory.find(store => store.name === 'photoQueryRowsV2')).toEqual({ name: 'photoQueryRowsV2', keyPath: 'key', indexes: [
		{ name: 'capture-time', keyPath: ['catalogId', 'captureBucket', 'captureSort', 'photoId'], unique: false, multiEntry: false },
		{ name: 'catalogId', keyPath: 'catalogId', unique: false, multiEntry: false },
		{ name: 'file-name', keyPath: ['catalogId', 'fileNameSort', 'photoId'], unique: false, multiEntry: false },
		{ name: 'photo-id', keyPath: ['catalogId', 'photoId'], unique: false, multiEntry: false },
		{ name: 'rating', keyPath: ['catalogId', 'ratingSort', 'photoId'], unique: false, multiEntry: false },
	] });
	expect(result.inventory.find(store => store.name === 'photoQueryBuildStatesV2')).toEqual({ name: 'photoQueryBuildStatesV2', keyPath: 'id', indexes: [] });
	expect(result.query).toMatchObject({ ids: Array.from({ length: 17 }, (_, index) => `photo-${String(index).padStart(6, '0')}`), maximumScanned: 17, maximumNativeRows: 17 });
	expect(result.query.maximumSummaryBytes).toBeLessThanOrEqual(4096);
	for (const step of [result.first, result.second]) expect(step.bytes + step.derivedBytes).toBeLessThanOrEqual(8_388_608);
});

test('native legal escaped and multibyte Row2 publication browses scalar summaries and joins late cancellation with atomic rollback', async ({ page }) => {
	test.setTimeout(180_000);
	await setup(page);
	const result = await page.evaluate(qualifyStorage, { path: MODULE, mode: 'large' });
	expect(result).toMatchObject({ published: 8, legacyNotReady: true, originalDocumentsUnchanged: true, forbiddenRequests: 0,
		cancel: { exactReason: true, reasonInspections: 0, successfulRowPuts: 2, successfulCountPuts: 2, rowsAbsent: true, buildAbsent: true }, activeTransactions: 0 });
	expect(result.rowBytes).toHaveLength(8);
	for (const size of result.rowBytes) { expect(size).toBeGreaterThan(524_288); expect(size).toBeLessThanOrEqual(1_048_576); }
	expect(result.steps[0].processed).toBeLessThan(8);
	for (const step of result.steps) {
		expect(step.processed).toBeLessThanOrEqual(16); expect(step.bytes + step.derivedBytes).toBeLessThanOrEqual(8_388_608);
		expect(step.sourceDeliveries).toBeLessThanOrEqual(step.processed + 1);
	}
	expect(result.query.ids).toHaveLength(8); expect(result.query.maximumScanned).toBeLessThanOrEqual(64);
	expect(result.query.maximumNativeRows).toBeLessThanOrEqual(64); expect(result.query.maximumSummaryBytes).toBeLessThanOrEqual(4096);
});

test('native metadata collapsed continuation authenticates65 members and refuses a physical second connection before transaction', async ({ page }) => {
	test.setTimeout(180_000);
	await setup(page);
	const result = await page.evaluate(qualifyStorage, { path: MODULE, mode: 'connection' });
	expect(result).toMatchObject({ distinctNativeConnections: true, first: { items: 0, scanned: 64, pending: true },
		foreignRefused: true, foreignTransactions: 0, ids: ['photo-000000'], forbiddenRequests: 0, activeTransactions: 0 });
	expect(result.maximumScanned).toBeLessThanOrEqual(64); expect(result.maximumNativeRows).toBeLessThanOrEqual(64);
	expect(result.steps).toBeGreaterThanOrEqual(2);
});

async function setup(page) {
	const bundle = await build({ stdin: { contents: ENTRY, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), sourcefile: 'metadata-storage-native.js' },
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	await page.route(`**${MODULE}`, route => route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }));
	const origin = process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ? JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS).lightscaper : browserProductSiteForBuild('lightscaper').origin;
	await page.goto(`${origin}/en/`); await expect(page.locator('[data-lightscaper-bound="true"]')).toBeVisible();
}

/** Metadata-only storage fixtures. Synthetic originals deliberately do not claim media/decoder qualification. */
async function qualifyStorage({ path, mode }) {
	const api = await import(new URL(path, location.href).href), prefix = `metadata-query-native-${crypto.randomUUID()}`;
	const connections = [], repositories = [], databases = [], pendingTransactions = new Set();
	const stats = { phase: 'setup', upgradeRequests: 0, sourceDeliveries: 0, rowDeliveries: 0, forbiddenRequests: 0,
		activeTransactions: 0, foreignTransactions: 0, successfulRowPuts: 0, successfulCountPuts: 0 };
	let foreignConnection = null, cancelAtSecondCount = null;
	const restore = installNativeObservers();
	let result, failed = false, failure;
	try {
		if (mode === 'migration') result = await migration();
		else if (mode === 'large') result = await large();
		else if (mode === 'connection') result = await connectionAuthority();
		else throw new RangeError('Unsupported native metadata qualification mode.');
	} catch (error) { failed = true; failure = error; }
	// No pending callback or transaction outlives prototype restoration or scratch database disposal.
	const settled = await Promise.allSettled(repositories.map(repository => repository.close()));
	const cleanupFailures = settled.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason);
	for (const database of connections) { try { database.close(); } catch (error) { cleanupFailures.push(error); } }
	await Promise.all([...pendingTransactions]); restore();
	for (const name of databases) { try { await deleteDatabase(name); } catch (error) { cleanupFailures.push(error); } }
	if (cleanupFailures.length) throw new AggregateError(failed ? [failure, ...cleanupFailures] : cleanupFailures, 'Native metadata fixture owner cleanup failed.');
	if (failed) throw failure;
	return result;

	async function migration() {
		const name = scratch('migration'), old = await openLegacy3(name); connections.push(old);
		const root = api.normalizePhotoCatalogRootV1({ ...api.queryCatalogRootV1(), revision: 2, photoCount: 17 });
		await transaction(old, [...old.objectStoreNames], 'readwrite', stores => {
			stores.catalogs.put(root); stores.catalogStates.put(api.indexState(root, 2));
			stores.photoQueryBuildStates.put({ id: root.id, schemaVersion: 1, ready: true, afterKey: null, indexedCount: 17 });
			for (let index = 0; index < 17; index++) {
				const photo = api.queryPhotoV1(index), key = `${root.id}|${photo.id}`;
				stores.photos.put({ key, document: photo }); stores.summaries.put(api.photoSummary(photo));
				stores.photoQueryRows.put(api.projectPhotoQueryRowV1(photo));
				for (const row of api.photoMemberships(photo)) stores.memberships.put(row);
			}
		});
		const oldInventory = inventory(old), before = await legacyFingerprint(old); old.close();
		stats.phase = 'upgrade'; const database = await api.openPhotoCatalogDatabaseV1(indexedDB, name, () => undefined); connections.push(database);
		const upgradeRequests = stats.upgradeRequests; stats.phase = 'inspection';
		const untouchedLegacy = before === await legacyFingerprint(database), oldBuild = await point(database, 'photoQueryBuildStates', root.id);
		const newBuildInitiallyAbsent = await point(database, 'photoQueryBuildStatesV2', root.id) === undefined;
		const newRowsInitiallyAbsent = await pointKey(database, 'photoQueryRowsV2') === undefined;
		let repository = owner(name), missingV2Refused = false;
		const legacyRowsAfterUpgrade = (await repository.readQueryPage(root.id)).items.length;
		try { await repository.readQueryPageV2(root.id); } catch (error) { missingV2Refused = error.code === 'PHOTO_QUERY_INDEX_NOT_READY'; }
		const first = await repository.rebuildQueryIndexPageV2(root.id), firstBuild = await point(database, 'photoQueryBuildStatesV2', root.id);
		await repository.close(); database.close(); repository = owner(name);
		const second = await repository.rebuildQueryIndexPageV2(root.id), reopened = await api.openPhotoCatalogDatabaseV1(indexedDB, name, () => undefined); connections.push(reopened);
		const query = await browse(repository, root.id);
		return { oldVersion: 3, version: reopened.version, oldInventory, inventory: inventory(reopened), upgradeRequests, untouchedLegacy,
			missingV2Refused, oldReady: oldBuild.ready, legacyRowsAfterUpgrade, newBuildInitiallyAbsent, newRowsInitiallyAbsent, first, firstBuild, second, query,
			preservedAfterRebuild: before === await legacyFingerprint(reopened), forbiddenRequests: stats.forbiddenRequests, activeTransactions: stats.activeTransactions };
	}

	async function large() {
		const name = scratch('large'), repository = owner(name), catalogId = 'c'.repeat(128);
		const members = prefix => Array.from({ length: 1024 }, (_, index) => `${prefix}${String(index).padStart(4, '0')}${'x'.repeat(123)}`);
		let root = api.normalizePhotoCatalogRootV1({ ...api.queryCatalogRootV1(), id: catalogId,
			folders: [{ id: 'f'.repeat(128), name: 'F', parentId: null }],
			keywords: members('k').map(id => ({ id, name: 'K', parentId: null })), collections: members('m').map(id => ({ id, name: 'M', kind: 'manual' })) });
		await repository.createCatalog(root);
		const expected = [], rowBytes = [];
		for (let index = 0; index < 8; index++) {
			const character = index % 2 === 0 ? '\u0800' : '\ud800', base = api.queryPhotoV1(index), words = character.repeat(16_384), camera = character.repeat(1024);
			const photo = api.normalizePhotoDocumentV1({ ...base, catalogId, id: `${'p'.repeat(124)}${String(index).padStart(4, '0')}`,
				folderId: 'f'.repeat(128), activeVersionId: 'v'.repeat(128), versions: [{ ...base.versions[0], id: 'v'.repeat(128) }],
				original: { ...base.original, id: `${'s'.repeat(124)}${String(index).padStart(4, '0')}`,
					storageKey: `${'o'.repeat(124)}${String(index).padStart(4, '0')}`, width: 65_536, height: 65_536 },
				keywordIds: members('k'), collectionIds: members('m'), metadata: { ...base.metadata, fileName: character.repeat(256),
					title: words, caption: words, creator: words, copyright: words, location: words, cameraMake: camera, cameraModel: camera, lens: camera, iso: 200 } });
			const row = api.projectPhotoQueryRowV2(photo); rowBytes.push(bytes(row));
			expected.push({ id: photo.id, sha256: await hash(api.serializeLightscaperDocumentV1(photo)), sourceBytes: bytes(photo), derivedBytes: bytes(row) });
			root = await repository.publishPhotos(catalogId, root.revision, [photo]);
		}
		let legacyNotReady = false;
		try { await repository.readQueryPage(catalogId); } catch (error) { legacyNotReady = error.code === 'PHOTO_QUERY_INDEX_NOT_READY'; }
		const database = await api.openPhotoCatalogDatabaseV1(indexedDB, name, () => undefined); connections.push(database);
		const query = await browse(repository, catalogId);
		// Deliberate loss of derived caches only; canonical photo/root and the legacy profile remain intact.
		await clearV2(database);
		const steps = []; let ready = false, offset = 0;
		while (!ready && steps.length < 9) {
			stats.sourceDeliveries = 0;
			const progress = await repository.rebuildQueryIndexPageV2(catalogId);
			const selected = expected.slice(offset, offset + progress.processed);
			if (progress.bytes !== selected.reduce((sum, item) => sum + item.sourceBytes, 0)
				|| progress.derivedBytes !== selected.reduce((sum, item) => sum + item.derivedBytes, 0)) throw new Error('Native combined rebuild byte accounting disagrees.');
			steps.push({ ...progress, sourceDeliveries: stats.sourceDeliveries }); offset += progress.processed; ready = progress.ready;
		}
		if (!ready || offset !== 8) throw new Error('Native bounded rebuild did not finish its eight legal sources.');
		await clearV2(database); stats.successfulRowPuts = 0; stats.successfulCountPuts = 0;
		const stop = new AbortController(); let reasonInspections = 0;
		const reason = new Proxy({}, { get() { reasonInspections++; throw new Error('Opaque abort reason inspected.'); },
			getPrototypeOf() { reasonInspections++; throw new Error('Opaque abort prototype inspected.'); } });
		cancelAtSecondCount = { stop, reason }; let exactReason = false;
		try { await repository.rebuildQueryIndexPageV2(catalogId, { signal: stop.signal }); } catch (failure) { exactReason = failure === reason; }
		cancelAtSecondCount = null;
		const cancel = { exactReason, reasonInspections, successfulRowPuts: stats.successfulRowPuts, successfulCountPuts: stats.successfulCountPuts,
			rowsAbsent: await pointKey(database, 'photoQueryRowsV2') === undefined, buildAbsent: await point(database, 'photoQueryBuildStatesV2', catalogId) === undefined };
		let originalDocumentsUnchanged = true;
		for (const item of expected) {
			const photo = await repository.loadPhoto(catalogId, item.id);
			if (await hash(api.serializeLightscaperDocumentV1(photo)) !== item.sha256) originalDocumentsUnchanged = false;
		}
		return { published: 8, rowBytes, legacyNotReady, steps, query, cancel, originalDocumentsUnchanged,
			forbiddenRequests: stats.forbiddenRequests, activeTransactions: stats.activeTransactions };
	}

	async function connectionAuthority() {
		const name = scratch('connection'), repository = owner(name); let root = api.queryCatalogRootV1(); await repository.createCatalog(root);
		for (let offset = 0; offset < 65; offset += 16) root = await repository.publishPhotos(root.id, root.revision,
			Array.from({ length: Math.min(16, 65 - offset) }, (_, delta) => api.queryPhotoV1(offset + delta)));
		await repository.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id, id: 'native-stack', revision: 0,
			photoIds: Array.from({ length: 65 }, (_, index) => api.queryPhotoV1(index).id), coverPhotoId: api.queryPhotoV1().id }, null,
		{ expectedCatalogRevision: root.revision, expectedStateRevision: 0 });
		const firstConnection = await api.openPhotoCatalogDatabaseV1(indexedDB, name, () => undefined);
		const secondConnection = await api.openPhotoCatalogDatabaseV1(indexedDB, name, () => undefined); connections.push(firstConnection, secondConnection);
		const query = { schemaVersion: 2, kind: 'photo-catalog-query' };
		stats.rowDeliveries = 0; let step = await api.readPhotoStackQueryPageV2(firstConnection, root.id, { query });
		const first = { items: step.items.length, scanned: step.scanned, pending: step.continuation?.pending !== null && step.continuation?.pending !== undefined };
		let maximumScanned = step.scanned, maximumNativeRows = stats.rowDeliveries, steps = 1, foreignRefused = false;
		foreignConnection = secondConnection;
		try { await api.readPhotoStackQueryPageV2(secondConnection, root.id, { query, continuation: step.continuation }); }
		catch (error) { foreignRefused = error instanceof TypeError && /signature authentication/u.test(error.message); }
		foreignConnection = null; const ids = step.items.map(item => item.photoId);
		while (step.continuation && steps < 6) {
			stats.rowDeliveries = 0; step = await api.readPhotoStackQueryPageV2(firstConnection, root.id, { query, continuation: step.continuation });
			ids.push(...step.items.map(item => item.photoId)); maximumScanned = Math.max(maximumScanned, step.scanned);
			maximumNativeRows = Math.max(maximumNativeRows, stats.rowDeliveries); steps++;
		}
		if (step.continuation) throw new Error('Native65-member authentication did not finish its bounded continuation.');
		return { distinctNativeConnections: firstConnection !== secondConnection, first, foreignRefused, foreignTransactions: stats.foreignTransactions,
			ids, maximumScanned, maximumNativeRows, steps, forbiddenRequests: stats.forbiddenRequests, activeTransactions: stats.activeTransactions };
	}

	function scratch(suffix) { const name = `${prefix}-${suffix}`; databases.push(name); return name; }
	function owner(name) {
		const repository = new api.PhotoCatalogRepositoryV1({ indexedDB, databaseName: name, verifyOriginal: async () => undefined }); repositories.push(repository); return repository;
	}
	function bytes(value) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
	async function hash(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), value => value.toString(16).padStart(2, '0')).join(''); }
	async function browse(repository, catalogId) {
		let continuation = null, maximumScanned = 0, maximumNativeRows = 0, maximumSummaryBytes = 0; const ids = [];
		for (let index = 0; index < 4; index++) {
			stats.rowDeliveries = 0; const page = await repository.readQueryPageV2(catalogId, { continuation });
			ids.push(...page.items.map(item => item.photoId)); maximumScanned = Math.max(maximumScanned, page.scanned);
			maximumNativeRows = Math.max(maximumNativeRows, stats.rowDeliveries);
			for (const item of page.items) {
				if ('metadata' in item || 'original' in item || 'caption' in item || 'extractedMetadata' in item) throw new Error('Native browse exposed a full metadata/document body.');
				maximumSummaryBytes = Math.max(maximumSummaryBytes, bytes(item));
			}
			continuation = page.continuation; if (!continuation) return { ids, maximumScanned, maximumNativeRows, maximumSummaryBytes };
		}
		throw new Error('Bounded native scalar browse did not finish.');
	}
	async function legacyFingerprint(database) {
		const hashes = [];
		for (const store of ['catalogs', 'catalogStates', 'photoQueryBuildStates']) hashes.push(await hash(JSON.stringify(await point(database, store, 'catalog'))));
		for (let index = 0; index < 17; index++) {
			const key = `catalog|${api.queryPhotoV1(index).id}`;
			for (const store of ['photos', 'summaries', 'photoQueryRows']) hashes.push(await hash(JSON.stringify(await point(database, store, key))));
		}
		return hashes.join('|');
	}
	function inventory(database) {
		const tx = database.transaction([...database.objectStoreNames], 'readonly');
		return [...database.objectStoreNames].map(name => { const store = tx.objectStore(name); return { name, keyPath: store.keyPath,
			indexes: [...store.indexNames].map(name => { const index = store.index(name); return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; }) }; });
	}
	async function openLegacy3(name) {
		// Exact schema3 inventory from1236ef39b:catalog-database.ts/repository-types.ts; this opens genuine version3.
		const sortIndexes = { 'photo-id': ['catalogId', 'photoId'], 'file-name': ['catalogId', 'fileNameSort', 'photoId'],
			'capture-time': ['catalogId', 'captureBucket', 'captureSort', 'photoId'], rating: ['catalogId', 'ratingSort', 'photoId'] };
		return new Promise((resolve, reject) => {
			const opening = indexedDB.open(name, 3);
			opening.onupgradeneeded = () => {
				for (const name of ['catalogs', 'catalogStates', 'photos', 'summaries', 'memberships', 'photoQueryRows', 'photoQueryBuildStates', 'photoStacks', 'photoStackMemberships', 'photoStackStates']) {
					const keyPath = name === 'photoStackStates' ? 'catalogId' : ['catalogs', 'catalogStates', 'photoQueryBuildStates'].includes(name) ? 'id' : 'key';
					const store = opening.result.createObjectStore(name, { keyPath });
					if (['summaries', 'photoStacks', 'photoStackMemberships'].includes(name)) store.createIndex('catalogId', 'catalogId');
					if (['memberships', 'photoStackMemberships'].includes(name)) store.createIndex('scope', 'scope');
					if (name === 'photoStacks') store.createIndex('memberKey', 'memberKeys', { unique: true, multiEntry: true });
					if (name === 'photoQueryRows') { store.createIndex('catalogId', 'catalogId'); for (const [sort, fields] of Object.entries(sortIndexes)) store.createIndex(sort, [...fields]); }
				}
			};
			opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
		});
	}
	async function point(database, store, key) {
		let value; await transaction(database, [store], 'readonly', stores => { const request = stores[store].get(key); request.addEventListener('success', () => { value = request.result; }, { once: true }); }); return value;
	}
	async function pointKey(database, store) {
		let value; await transaction(database, [store], 'readonly', stores => { const request = stores[store].getKey(IDBKeyRange.lowerBound('')); request.addEventListener('success', () => { value = request.result; }, { once: true }); }); return value;
	}
	async function clearV2(database) { await transaction(database, ['photoQueryRowsV2', 'photoQueryBuildStatesV2'], 'readwrite', stores => { stores.photoQueryRowsV2.clear(); stores.photoQueryBuildStatesV2.clear(); }); }
	async function transaction(database, names, mode, operation) {
		await new Promise((resolve, reject) => {
			const tx = database.transaction(names, mode); tx.addEventListener('complete', resolve, { once: true }); tx.addEventListener('abort', () => reject(tx.error ?? new Error('Native fixture transaction aborted.')), { once: true });
			try { operation(Object.fromEntries(names.map(name => [name, tx.objectStore(name)]))); } catch (error) { tx.abort(); reject(error); }
		});
	}
	async function deleteDatabase(name) { await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Scratch database cleanup was blocked.')); }); }
	function installNativeObservers() {
		const restores = [], patch = (prototype, method, replacement) => { const original = prototype[method]; prototype[method] = replacement(original); restores.push(() => { prototype[method] = original; }); };
		patch(IDBDatabase.prototype, 'transaction', original => function (...args) {
			const tx = Reflect.apply(original, this, args);
			if (this.name.startsWith(prefix)) {
				stats.activeTransactions++; if (this === foreignConnection) stats.foreignTransactions++;
				let finish; const settlement = new Promise(resolve => { finish = resolve; }); pendingTransactions.add(settlement);
				const done = () => { stats.activeTransactions--; pendingTransactions.delete(settlement); finish(); };
				tx.addEventListener('complete', done, { once: true }); tx.addEventListener('abort', done, { once: true });
			}
			return tx;
		});
		for (const prototype of [IDBObjectStore.prototype, IDBIndex.prototype]) for (const method of ['get', 'getKey', 'openCursor', 'openKeyCursor', 'getAll', 'getAllKeys', 'count']) {
			patch(prototype, method, original => function (...args) {
				const store = this instanceof IDBIndex ? this.objectStore : this, owned = store.transaction.db.name.startsWith(prefix);
				if (owned && (method === 'getAll' || method === 'getAllKeys' || method === 'count')) { stats.forbiddenRequests++; throw new Error('Native metadata fixture refuses aggregate scans.'); }
				const request = Reflect.apply(original, this, args);
				if (owned) {
					if (stats.phase === 'upgrade') stats.upgradeRequests++;
					request.addEventListener('success', () => {
						if (request.result === null || request.result === undefined) return;
						if (store.name === 'photos' && method === 'openCursor') stats.sourceDeliveries++;
						if (store.name === 'photoQueryRowsV2' && (method === 'get' || method === 'openCursor')) stats.rowDeliveries++;
					});
				}
				return request;
			});
		}
		patch(IDBObjectStore.prototype, 'put', original => function (...args) {
			const request = Reflect.apply(original, this, args);
			if (this.transaction.db.name.startsWith(prefix) && cancelAtSecondCount) {
				const name = this.name, value = args[0], active = cancelAtSecondCount;
				request.addEventListener('success', () => {
					if (name === 'photoQueryRowsV2') stats.successfulRowPuts++;
					if (name === 'photoQueryBuildStatesV2') {
						stats.successfulCountPuts++; if (value.indexedCount === 2) active.stop.abort(active.reason);
					}
				}, { once: true });
			}
			return request;
		});
		return () => { for (const restore of restores.reverse()) restore(); };
	}
}
