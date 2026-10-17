/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { openPhotoCatalogDatabaseV1 } from '../../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { PHOTO_CATALOG_STORES } from '../../src/lightscaper/catalog/repository-types.ts';
import { indexState, photoMemberships, photoSummary } from '../../src/lightscaper/catalog/repository-records.ts';
import { PHOTO_QUERY_INDEXES_V1, projectPhotoQueryRowV1 } from '../../src/lightscaper/catalog/photo-query-index-v1.ts';
import { PHOTO_QUERY_INDEXES_V2, projectPhotoQueryRowV2 } from '../../src/lightscaper/catalog/photo-query-index-v2.ts';
import type { PhotoCatalogQueryV2 } from '../../src/lightscaper/catalog/photo-query-types-v2.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1, photoSmartCollectionRecordV1,
	photoSmartCollectionReferenceKeyV1 } from '../../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { normalizePhotoSmartCollectionsStateV1 } from '../../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './lightscaper-catalog-query-fixture.ts';
import { nativeSmartCollectionBytesV1 as bytes, nativeSmartCollectionTransactionV1 as transaction,
	nativeSmartCollectionPointV1 as point, nativeSmartCollectionFingerprintV1 as fingerprint,
	observeNativeSmartCollectionsV1, type NativeSmartCollectionTransactionV1 } from './lightscaper-smart-collections-native-observer.ts';

const OLD_STORES = ['catalogs', 'catalogStates', 'photos', 'summaries', 'memberships', 'photoQueryRows', 'photoQueryBuildStates',
	'photoStacks', 'photoStackMemberships', 'photoStackStates', 'photoQueryRowsV2', 'photoQueryBuildStatesV2'] as const;
const NEW_STORES = ['photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates'] as const;
type Mode = 'migration' | 'paging' | 'cancellation' | 'capacity';
type Receipt = Awaited<ReturnType<PhotoCatalogRepositoryV1['saveSmartCollection']>>;

/** Actual native metadata storage. Synthetic originals do not qualify media custody or decoding. */
export async function qualifyNativeSmartCollectionsV1(mode: Mode) {
	const prefix = `saved-queries-native-${crypto.randomUUID()}`, connections: IDBDatabase[] = [], owners: PhotoCatalogRepositoryV1[] = [];
	const names: string[] = [], observer = observeNativeSmartCollectionsV1(prefix);
	let result: unknown, failed = false, failure: unknown;
	try {
		switch (mode) {
			case 'migration': result = await migration(); break;
			case 'paging': result = await paging(); break;
			case 'cancellation': result = await cancellation(); break;
			case 'capacity': result = await capacity(); break;
		}
	} catch (error) { failed = true; failure = error; }
	const cleanup: unknown[] = [];
	for (const outcome of await Promise.allSettled(owners.map(owner => owner.close()))) if (outcome.status === 'rejected') cleanup.push(outcome.reason);
	for (const connection of connections) { try { connection.close(); } catch (error) { cleanup.push(error); } }
	await observer.settle(); observer.restore();
	for (const name of names) {
		try {
			await new Promise<void>((resolve, reject) => {
				const request = indexedDB.deleteDatabase(name);
				request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
				request.onblocked = () => reject(new Error('Owned native saved-query cleanup was blocked.'));
			});
		} catch (error) { cleanup.push(error); }
	}
	if (cleanup.length) throw new AggregateError(failed ? [failure, ...cleanup] : cleanup, 'Native saved-query owner cleanup failed.');
	if (failed) throw failure;
	return { result, forbiddenRequests: observer.forbiddenRequests, activeTransactions: observer.activeTransactions };

	function scratch(suffix: string): string { const name = `${prefix}-${suffix}`; names.push(name); return name; }
	function owner(name: string): PhotoCatalogRepositoryV1 {
		const repository = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: name, verifyOriginal: async () => undefined });
		owners.push(repository); return repository;
	}
	async function connection(name: string): Promise<IDBDatabase> {
		const database = await openPhotoCatalogDatabaseV1(indexedDB, name, () => undefined); connections.push(database); return database;
	}
	function options(receipt: Receipt) {
		return { expectedCatalogRevision: receipt.catalogRevision, expectedIndexRevision: receipt.indexRevision,
			expectedStateRevision: receipt.state.revision };
	}
	function definition(id: string, large = false) {
		const query: PhotoCatalogQueryV2 = { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Landscape',
			filter: { kind: 'folder', id: 'empty-folder' }, sort: { field: 'capture-time', direction: 'descending' },
			predicate: large ? { kind: 'all', terms: Array.from({ length: 255 }, () =>
				({ kind: 'text', column: 'title', operator: 'equals', value: '\ud800'.repeat(256) } as const)) }
				: { kind: 'all', terms: [{ kind: 'rating', minimum: 5, maximum: 5 }, { kind: 'keyword', id: 'empty-keyword' }] } };
		return normalizePhotoSmartCollectionV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog', id, revision: 0,
			name: `Saved ${id}`, query });
	}
	function root() {
		return normalizePhotoCatalogRootV1({ ...queryCatalogRootV1(),
			folders: [...queryCatalogRootV1().folders, { id: 'empty-folder', name: 'Empty', parentId: null }],
			keywords: [...queryCatalogRootV1().keywords, { id: 'empty-keyword', name: 'Empty', parentId: null }] });
	}
	async function refused(operation: () => Promise<unknown>): Promise<boolean> {
		try { await operation(); return false; } catch (error) { if (!(error instanceof Error)) throw error; return true; }
	}

	async function migration() {
		const name = scratch('db4'), old = await openLegacy4(name); connections.push(old);
		const catalog = normalizePhotoCatalogRootV1({ ...root(), revision: 2, photoCount: 17 });
		await transaction(old, OLD_STORES, 'readwrite', stores => {
			stores.catalogs!.put(catalog); stores.catalogStates!.put(indexState(catalog, 4));
			stores.photoStackStates!.put({ schemaVersion: 1, kind: 'photo-stack-state', catalogId: catalog.id, revision: 23, stackCount: 0 });
			for (const [store, schemaVersion] of [['photoQueryBuildStates', 1], ['photoQueryBuildStatesV2', 2]] as const) {
				stores[store]!.put({ id: catalog.id, schemaVersion, ready: true, afterKey: null, indexedCount: 17 });
			}
			for (let index = 0; index < 17; index++) {
				const photo = queryPhotoV1(index);
				stores.photos!.put({ key: `${catalog.id}|${photo.id}`, document: photo }); stores.summaries!.put(photoSummary(photo));
				stores.photoQueryRows!.put(projectPhotoQueryRowV1(photo)); stores.photoQueryRowsV2!.put(projectPhotoQueryRowV2(photo));
				for (const row of photoMemberships(photo)) stores.memberships!.put(row);
			}
		});
		observer.phase = 'inspect'; const before = await fingerprint(old, OLD_STORES), oldInventory = await inventory(old);
		const legacyTransactionsBeforeUpgrade = observer.activeTransactions; old.close();
		observer.phase = 'upgrade'; const database = await connection(name), upgradeRequests = observer.upgradeRequests;
		observer.phase = 'inspect'; const unchanged = before === await fingerprint(database, OLD_STORES), newInventory = await inventory(database);
		const repository = owner(name); observer.phase = 'load'; const emptyState = await repository.readSmartCollectionState('catalog');
		observer.phase = 'inspect'; const noDurableState = await point(database, 'photoSmartCollectionStates', 'catalog') === undefined;
		await repository.close(); const reopened = owner(name); observer.phase = 'load';
		const persisted = await reopened.readSmartCollectionState('catalog');
		return { oldVersion: 4, version: database.version, upgradeRequests, legacyTransactionsBeforeUpgrade, unchanged, oldInventory, newInventory,
			emptyState, persisted, noDurableState };
	}

	async function paging() {
		const name = scratch('pages'), repository = owner(name); await repository.createCatalog(root());
		const published = await repository.publishPhotos('catalog', 0, [queryPhotoV1(0), queryPhotoV1(1)]);
		const database = await connection(name); observer.phase = 'inspect';
		const bodyBefore = await fingerprint(database, OLD_STORES.filter(name => !['catalogs', 'catalogStates'].includes(name)));
		observer.phase = 'write'; let receipt = await repository.saveSmartCollection(definition('saved-000'), null,
			{ expectedCatalogRevision: published.revision, expectedIndexRevision: 1, expectedStateRevision: 0 });
		for (let index = 1; index < 65; index++) receipt = await repository.saveSmartCollection(definition(`saved-${String(index).padStart(3, '0')}`), null, options(receipt));
		const maximal = definition('saved-maximum', true); receipt = await repository.saveSmartCollection(maximal, null, options(receipt));
		observer.phase = 'list'; const offset = observer.transactions.length;
		const first = await repository.readSmartCollectionPage('catalog'), second = await repository.readSmartCollectionPage('catalog', { continuation: first.continuation });
		const pages = observer.transactions.slice(offset), fullQueryReads = pages.reduce((sum, value) => sum + value.definitionReads, 0);
		const ids = [...first.items, ...second.items].map(item => item.id);
		if ([...first.items, ...second.items].some(item => 'query' in item)) throw new Error('Native saved-query summaries exposed predicates.');
		observer.phase = 'load'; const loadOffset = observer.transactions.length, loaded = await repository.loadSmartCollection('catalog', maximal.id);
		const fullLoadReads = observer.transactions.slice(loadOffset).reduce((sum, value) => sum + value.definitionReads, 0);
		const current = await repository.loadCatalog('catalog'); if (!current) throw new Error('Native saved-query catalog is missing.');
		const retainedRoot = JSON.stringify(current);
		const missingFolderRefused = await refused(() => repository.saveCatalog({ ...current, folders: current.folders.filter(node => node.id !== 'empty-folder') }, current.revision));
		const falseBranchRefused = await refused(() => repository.saveCatalog({ ...current, keywords: current.keywords.filter(node => node.id !== 'empty-keyword') }, current.revision));
		const laterIdRefused = await refused(() => repository.saveCatalog({ ...current,
			collections: [...current.collections, { id: 'saved-064', name: 'Collision', kind: 'manual' }] }, current.revision));
		observer.phase = 'setup'; let negativeIndex = false;
		// Corrupt every projection to establish an actual negative reference-index witness.
		await transaction(database, ['photoSmartCollections'], 'readwrite', stores => {
			const cursor = stores.photoSmartCollections!.openCursor(); cursor.addEventListener('success', () => {
				const row = cursor.result;
				if (row) { const value = row.value as Readonly<Record<string, unknown>>; row.update({ ...value, referenceKeys: [] }); row.continue(); }
			});
		});
		await transaction(database, ['photoSmartCollections'], 'readonly', stores => {
			const request = stores.photoSmartCollections!.index('referenceKey').getKey(photoSmartCollectionReferenceKeyV1('catalog', 'folder', 'empty-folder'));
			request.addEventListener('success', () => { negativeIndex = request.result === undefined; }, { once: true });
		});
		observer.phase = 'audit'; const corruptProjectionRefused = await refused(() => repository.saveCatalog({ ...current,
			folders: current.folders.filter(node => node.id !== 'empty-folder') }, current.revision));
		observer.phase = 'inspect'; const unchangedRoot = retainedRoot === JSON.stringify(await repository.loadCatalog('catalog'));
		const bodyUnchanged = bodyBefore === await fingerprint(database, OLD_STORES.filter(name => !['catalogs', 'catalogStates'].includes(name)));
		return { total: receipt.state.collectionCount, ids, firstSize: first.items.length, secondSize: second.items.length,
			finished: second.continuation === null, fullQueryReads, fullLoadReads, maximumSummaryBytes: Math.max(...pages.map(value => value.summaryBytes)),
			maximumSummaryRows: Math.max(...pages.map(value => value.summaryDeliveries)), exactQuery: JSON.stringify(loaded?.query) === JSON.stringify(maximal.query),
			maximalBytes: bytes(photoSmartCollectionRecordV1(maximal)), missingFolderRefused, falseBranchRefused, laterIdRefused,
			negativeIndex, corruptProjectionRefused, unchangedRoot, bodyUnchanged };
	}

	async function cancellation() {
		const name = scratch('cancel'), repository = owner(name); await repository.createCatalog(root()); const database = await connection(name);
		observer.phase = 'inspect'; const before = await fingerprint(database, PHOTO_CATALOG_STORES);
		const stop = new AbortController(); let reasonInspections = 0;
		const reason = new Proxy({}, { get() { reasonInspections++; throw new Error('Native opaque reason inspected.'); },
			getPrototypeOf() { reasonInspections++; throw new Error('Native opaque reason prototype inspected.'); } });
		observer.phase = 'write'; const offset = observer.transactions.length;
		observer.onPut = store => { if (store === 'photoSmartCollectionStates') stop.abort(reason); };
		let exactReason = false;
		try { await repository.saveSmartCollection(definition('cancelled'), null,
			{ expectedCatalogRevision: 0, expectedIndexRevision: 0, expectedStateRevision: 0, signal: stop.signal }); }
		catch (error) { exactReason = error === reason; }
		observer.onPut = null;
		const successfulPuts = observer.transactions.slice(offset).reduce((sum, value) => sum + value.successfulPuts, 0);
		observer.phase = 'inspect'; const rolledBack = before === await fingerprint(database, PHOTO_CATALOG_STORES);
		await repository.close(); const reopened = owner(name); observer.phase = 'load'; const empty = await reopened.readSmartCollectionState('catalog');
		const late = new AbortController(); observer.phase = 'write';
		observer.onComplete = record => { if (record.mode === 'readwrite' && record.stores.includes('photoSmartCollections')) late.abort('after durable completion'); };
		const receipt = await reopened.saveSmartCollection(definition('acknowledged'), null,
			{ expectedCatalogRevision: 0, expectedIndexRevision: 0, expectedStateRevision: 0, signal: late.signal });
		observer.onComplete = null; observer.phase = 'load';
		const persisted = await reopened.loadSmartCollection('catalog', 'acknowledged');
		const deleted = await reopened.deleteSmartCollection('catalog', 'acknowledged', 0, options(receipt));
		await reopened.close(); const final = owner(name), tombstone = await final.readSmartCollectionState('catalog');
		const staleRefused = await refused(() => final.saveSmartCollection(definition('acknowledged'), null,
			{ expectedCatalogRevision: 0, expectedIndexRevision: 0, expectedStateRevision: 0 }));
		return { exactReason, reasonInspections, successfulPuts, rolledBack, empty, lateAborted: late.signal.aborted,
			acknowledged: persisted?.id === receipt.definition?.id, receipt, deleted, tombstone, staleRefused };
	}

	async function capacity() {
		const name = scratch('capacity'), repository = owner(name);
		const catalog = normalizePhotoCatalogRootV1({ ...root(), keywords: [...root().keywords,
			...Array.from({ length: 7800 }, (_, index) => ({ id: `large-keyword-${String(index).padStart(4, '0')}`, name: 'x'.repeat(200), parentId: null }))] });
		const rootBytes = bytes(catalog); if (rootBytes > 2_097_152) throw new Error('Native byte-boundary root is not legal.');
		await repository.createCatalog(catalog); const database = await connection(name);
		const definitions = Array.from({ length: 12 }, (_, index) => definition(`maximal-${String(index).padStart(2, '0')}`, true));
		await transaction(database, NEW_STORES, 'readwrite', stores => {
			for (const item of definitions) { stores.photoSmartCollections!.put(photoSmartCollectionRecordV1(item)); stores.photoSmartCollectionSummaries!.put(photoSmartCollectionSummaryRecordV1(item)); }
			stores.photoSmartCollectionStates!.put(normalizePhotoSmartCollectionsStateV1({ schemaVersion: 1, kind: 'photo-smart-collections-state',
				catalogId: catalog.id, revision: 1, collectionCount: definitions.length }));
		});
		const candidate = normalizePhotoCatalogRootV1({ ...catalog, name: 'Byte-boundary rename' });
		const chosenBytes = bytes(candidate);
		observer.phase = 'audit'; const offset = observer.transactions.length;
		const saved = await repository.saveCatalog(candidate, catalog.revision);
		const pages = observer.transactions.slice(offset).filter(value => value.mode === 'readonly' && value.definitionReads > 0);
		const charged = (value: NativeSmartCollectionTransactionV1) => chosenBytes + value.rootBytes + value.contextBytes + value.definitionBytes + value.summaryBytes
			+ PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + 524_288;
		return { rootBytes, definitionBytes: bytes(photoSmartCollectionRecordV1(definitions[0]!)), pageCount: pages.length,
			maximumDefinitions: Math.max(...pages.map(value => value.definitionReads)), maximumChargedBytes: Math.max(...pages.map(charged)),
			maximumKeyDeliveries: Math.max(...observer.transactions.slice(offset).map(value => value.keyDeliveries)),
			savedRevision: saved.revision, savedState: await repository.readSmartCollectionState(catalog.id) };
	}
}

async function openLegacy4(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(name, 4);
		request.onupgradeneeded = () => {
			for (const name of OLD_STORES) {
				const keyPath = name === 'photoStackStates' ? 'catalogId' : ['catalogs', 'catalogStates', 'photoQueryBuildStates', 'photoQueryBuildStatesV2'].includes(name) ? 'id' : 'key';
				const store = request.result.createObjectStore(name, { keyPath });
				if (['summaries', 'photoStacks', 'photoStackMemberships', 'photoQueryRows', 'photoQueryRowsV2'].includes(name)) store.createIndex('catalogId', 'catalogId');
				if (['memberships', 'photoStackMemberships'].includes(name)) store.createIndex('scope', 'scope');
				if (name === 'photoStacks') store.createIndex('memberKey', 'memberKeys', { unique: true, multiEntry: true });
				if (name === 'photoQueryRows' || name === 'photoQueryRowsV2') {
					for (const [sort, fields] of Object.entries(name === 'photoQueryRows' ? PHOTO_QUERY_INDEXES_V1 : PHOTO_QUERY_INDEXES_V2)) store.createIndex(sort, [...fields]);
				}
			}
		};
		request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
	});
}

interface NativeInventoryStoreV1 {
	readonly name: string;
	readonly keyPath: string | string[] | null;
	readonly indexes: readonly Readonly<{ name: string; keyPath: string | string[]; multiEntry: boolean; unique: boolean }>[];
}
async function inventory(database: IDBDatabase): Promise<readonly NativeInventoryStoreV1[]> {
	const names = [...database.objectStoreNames], result: NativeInventoryStoreV1[] = [];
	await transaction(database, names, 'readonly', stores => {
		for (const name of names) {
			const store = stores[name]!;
			result.push({ name, keyPath: store.keyPath, indexes: [...store.indexNames].map(name => {
				const index = store.index(name); return { name, keyPath: index.keyPath, multiEntry: index.multiEntry, unique: index.unique };
			}) });
		}
	});
	return result;
}
