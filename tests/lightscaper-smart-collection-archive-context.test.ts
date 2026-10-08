/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { readPhotoSmartCollectionArchiveContextV1 } from '../src/lightscaper/catalog/photo-smart-collection-archive-context-v1.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { SMART_COLLECTION_TEST_DATABASE as DB, smartCollectionDefinitionV1 as definition,
	smartCollectionRepositoryFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-repository-fixture.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
type RecordedGet = Readonly<{ store: string }>;
const contents = (f: Fixture) => PHOTO_CATALOG_STORES.map(store => f.indexedDB.records(DB, store));
const state = (collectionCount = 0, revision = 0) => ({ schemaVersion: 1, kind: 'photo-smart-collections-state',
	catalogId: 'catalog', revision, collectionCount });
async function close(f: Fixture) { f.database.close(); await f.repository.close(); }

test('archive context distinguishes physical absence from a retained empty state even at revision zero', async () => {
	for (const persisted of [null, state(), state(0, 37)]) {
		const f = await fixture();
		try {
			if (persisted !== null) f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', persisted);
			const before = contents(f);
			const captured = await f.repository.readSmartCollectionArchiveContextV1('catalog');
			assert.deepEqual(captured, { schemaVersion: 1, kind: 'photo-smart-collection-archive-context',
				catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, state: persisted });
			assert.ok(Object.isFrozen(captured));
			if (captured.state !== null) assert.ok(Object.isFrozen(captured.state));
			assert.deepEqual(contents(f), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await close(f); }
	}
});

test('a real save and final deletion preserve the exact incremented empty tombstone in archive context', async () => {
	const f = await fixture();
	try {
		await f.repository.saveSmartCollection(definition(), null, await f.writeOptions());
		const saved = await f.repository.readSmartCollectionArchiveContextV1('catalog');
		assert.deepEqual(saved.state, state(1, 1));
		await f.repository.deleteSmartCollection('catalog', 'saved', 0, await f.writeOptions());
		const empty = await f.repository.readSmartCollectionArchiveContextV1('catalog');
		assert.deepEqual(empty, { schemaVersion: 1, kind: 'photo-smart-collection-archive-context', catalogId: 'catalog',
			catalogRevision: 2, indexRevision: 2, state: state(0, 2) });
		assert.equal(f.indexedDB.recordCount(DB, 'photoSmartCollections'), 0);
		assert.equal(f.indexedDB.recordCount(DB, 'photoSmartCollectionSummaries'), 0);
		assert.equal(f.indexedDB.recordCount(DB, 'photoSmartCollectionStates'), 1);
	} finally { await close(f); }
});

test('archive context uses one five-store readonly transaction, three value gets and three key-only probes', async () => {
	const f = await fixture(); f.seed(65);
	const native = f.database.transaction.bind(f.database), transactions: { stores: string[]; mode: IDBTransactionMode }[] = [];
	const keys: { store: string; index: string | null; query: IDBValidKey }[] = [];
	f.database.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		transactions.push({ stores: typeof names === 'string' ? [names] : [...names], mode: mode ?? 'readonly' });
		const transaction = native(names, mode), objectStore = transaction.objectStore.bind(transaction);
		transaction.objectStore = (storeName: string) => {
			const store = objectStore(storeName), getKey = store.getKey.bind(store), index = store.index.bind(store);
			store.getKey = (query: IDBValidKey | IDBKeyRange) => {
				assert.equal(typeof query, 'string'); keys.push({ store: storeName, index: null, query: query as string }); return getKey(query);
			};
			store.index = (name: string) => {
				const scoped = index(name), getKey = scoped.getKey.bind(scoped);
				scoped.getKey = (query: IDBValidKey | IDBKeyRange) => {
					assert.equal(typeof query, 'string'); keys.push({ store: storeName, index: name, query: query as string }); return getKey(query);
				};
				return scoped;
			};
			return store;
		};
		return transaction;
	}) as IDBDatabase['transaction'];
	try {
		const before = contents(f), gets = f.indexedDB.stats.getRequests.length;
		const captured = await readPhotoSmartCollectionArchiveContextV1(f.database, 'catalog');
		assert.deepEqual(captured.state, state(65, 1));
		assert.deepEqual(transactions, [{ stores: ['catalogs', 'catalogStates', 'photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates'], mode: 'readonly' }]);
		assert.deepEqual(f.indexedDB.stats.getRequests.slice(gets).map((row: RecordedGet) => row.store), ['catalogs', 'catalogStates', 'photoSmartCollectionStates']);
		assert.deepEqual(keys, [
			{ store: 'photoSmartCollections', index: 'catalogId', query: 'catalog' },
			{ store: 'photoSmartCollectionSummaries', index: 'catalogId', query: 'catalog' },
			{ store: 'photoSmartCollectionStates', index: null, query: 'catalog' },
		]);
		assert.equal(f.indexedDB.stats.countRequests.length, 0); assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
		assert.equal(f.indexedDB.stats.cursorRequests.length, 0); assert.equal(f.indexedDB.stats.keyCursorRequests.length, 0);
		assert.deepEqual(Object.keys(captured), ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'state']);
		assert.deepEqual(contents(f), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.transaction = native; await close(f); }
});

test('archive context preserves foreign scopes and does not claim to audit the saved inventory count', async () => {
	const f = await fixture(); f.seed(1);
	try {
		const foreign = { ...definition('foreign-saved'), catalogId: 'foreign' };
		f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1(foreign));
		f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(foreign));
		// Point context authenticates the first paired key only. The later bounded archive audit must reject this count.
		f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', state(2, 29));
		const before = contents(f), captured = await f.repository.readSmartCollectionArchiveContextV1('catalog');
		assert.deepEqual(captured.state, state(2, 29)); assert.deepEqual(contents(f), before);
	} finally { await close(f); }
});

test('archive context refuses missing or empty state with either orphan and positive state without both paired first keys', async () => {
	for (const count of [0, 1]) for (const side of ['definition', 'summary', 'neither'] as const) {
		for (const persisted of count === 0 ? [null, state(0, 37)] : [state(1, 37)]) {
			const f = await fixture();
			try {
				if (persisted !== null) f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', persisted);
				if (side === 'definition') f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1(definition()));
				if (side === 'summary') f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(definition()));
				if (count === 0 && side === 'neither') continue;
				const before = contents(f); await assert.rejects(f.repository.readSmartCollectionArchiveContextV1('catalog'));
				assert.deepEqual(contents(f), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
			} finally { await close(f); }
		}
	}
});

test('archive context refuses malformed physical state, root/index drift and noncanonical paired first keys', async () => {
	for (const corruption of ['state-null', 'state-future', 'state-id', 'state-count', 'index-revision', 'index-count', 'root-id', 'key'] as const) {
		const f = await fixture(); f.seed(1);
		try {
			if (corruption === 'state-null') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', null, 'catalog');
			if (corruption === 'state-future') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', { ...state(1), schemaVersion: 2 });
			if (corruption === 'state-id') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', { ...state(1), catalogId: 'foreign' }, 'catalog');
			if (corruption === 'state-count') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', state(10_001));
			if (corruption === 'index-revision' || corruption === 'index-count') {
				const context = await f.context();
				f.indexedDB.seedRecord(DB, 'catalogStates', { ...context.index, [corruption === 'index-revision' ? 'rootRevision' : 'photoCount']: 1 });
			}
			if (corruption === 'root-id') {
				const root = await f.repository.loadCatalog('catalog'); assert.ok(root);
				f.indexedDB.seedRecord(DB, 'catalogs', { ...root, id: 'foreign' }, 'catalog');
			}
			if (corruption === 'key') {
				await f.mutate('photoSmartCollections', async store => { await f.request(store.delete(photoSmartCollectionRecordV1(definition('saved-0000')).key)); });
				f.indexedDB.seedRecord(DB, 'photoSmartCollections', { ...photoSmartCollectionRecordV1(definition('saved-0000')), key: '["foreign","saved"]' });
			}
			const before = contents(f); await assert.rejects(f.repository.readSmartCollectionArchiveContextV1('catalog'));
			assert.deepEqual(contents(f), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await close(f); }
	}
});

test('unbranded oversized root is refused before state or saved-key reads', async () => {
	const f = await fixture();
	try {
		const root = await f.repository.loadCatalog('catalog'); assert.ok(root);
		const oversized = { ...root, keywords: [...root.keywords, ...Array.from({ length: 10_000 - root.keywords.length },
			(_, index) => ({ id: `keyword-${String(index)}`, parentId: null, name: 'x'.repeat(256) }))] };
		assert.equal(normalizePhotoCatalogRootV1(oversized).keywords.length, 10_000);
		assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength > 2_097_152);
		f.indexedDB.seedRecord(DB, 'catalogs', oversized);
		const gets = f.indexedDB.stats.getRequests.length, before = contents(f);
		await assert.rejects(f.repository.readSmartCollectionArchiveContextV1('catalog'), /byte|budget|limit/iu);
		assert.deepEqual(f.indexedDB.stats.getRequests.slice(gets).map((row: RecordedGet) => row.store), ['catalogs']);
		assert.deepEqual(contents(f), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await close(f); }
});

test('closed options, malformed catalog and opaque native cancellation refuse before lazy database acquisition', async () => {
	let opens = 0, probes = 0;
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: { open() { opens++; throw new Error('No open allowed'); } } as unknown as IDBFactory,
		verifyOriginal: async () => undefined });
	try {
		for (const catalog of ['', 'bad|id', {}, 17]) await assert.rejects(repository.readSmartCollectionArchiveContextV1(catalog as string));
		for (const invalid of [{ future: true }, { continuation: null }, { signal: {} }, { [Symbol('hidden')]: true },
			Object.defineProperty({}, 'signal', { enumerable: true, get() { probes++; return undefined; } })]) {
			await assert.rejects(repository.readSmartCollectionArchiveContextV1('catalog', invalid));
		}
		for (const reason of [17, null, new Proxy({}, { get() { probes++; throw new Error('Opaque'); }, getPrototypeOf() { probes++; throw new Error('Opaque'); } })]) {
			await repository.readSmartCollectionArchiveContextV1('catalog', { signal: AbortSignal.abort(reason) })
				.then(() => assert.fail('Expected cancellation'), error => { assert.ok(error === reason); });
		}
		const signal = new AbortController().signal;
		Object.defineProperty(signal, 'throwIfAborted', { get() { probes++; throw new Error('No getter'); } });
		await assert.rejects(repository.readSmartCollectionArchiveContextV1('catalog', { signal }));
		assert.equal(opens, 0); assert.equal(probes, 0);
	} finally { await repository.close(); }
});

test('late native cancellation remains joined to readonly settlement and inspects no caller signal overrides or reason', async () => {
	const f = await fixture(); f.seed(1); const stop = new AbortController(); let probes = 0;
	const reason = new Proxy({}, { get() { probes++; throw new Error('Opaque'); }, getPrototypeOf() { probes++; throw new Error('Opaque'); } });
	try {
		const before = contents(f);
		f.indexedDB.onNextGetForStore('photoSmartCollectionStates', () => {
			Object.defineProperty(stop.signal, 'aborted', { get() { probes++; return false; } }); stop.abort(reason);
		});
		await f.repository.readSmartCollectionArchiveContextV1('catalog', { signal: stop.signal })
			.then(() => assert.fail('Expected cancellation'), error => { assert.ok(error === reason); });
		assert.equal(probes, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0); assert.deepEqual(contents(f), before);
	} finally { await close(f); }
});
