/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { indexState } from '../src/lightscaper/catalog/repository-records.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../src/lightscaper/catalog/types.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1 } from '../src/lightscaper/catalog/photo-smart-collection-audit-v1.ts';
import { queryCatalogRootV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { SMART_COLLECTION_TEST_DATABASE as DB, smartCollectionDefinitionV1 as definition,
	smartCollectionRepositoryFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-repository-fixture.ts';

const stores = ['catalogs', 'catalogStates', 'photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates'];
const options = { expectedCatalogRevision: 0, expectedIndexRevision: 0, expectedStateRevision: 0 };

test('closed full-query, write/read options and cursors refuse before database acquisition without evaluating getters', async () => {
	const indexedDB = createInstrumentedIndexedDB(), nativeOpen = indexedDB.open.bind(indexedDB); let opens = 0, getters = 0;
	indexedDB.open = (name, version) => { opens++; return nativeOpen(name, version); };
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory, verifyOriginal: async () => undefined });
	const accessor = Object.defineProperty({}, 'expectedCatalogRevision', { enumerable: true, get() { getters++; return 0; } });
	const sparse = Array(1), terms = Object.defineProperty([], '0', { enumerable: true, get() { getters++; return { kind: 'folder', id: 'folder' }; } });
	const badOptions = [undefined, null, {}, accessor, { ...options, extra: 1 }, { ...options, expectedIndexRevision: -1 },
		{ ...options, signal: Object.defineProperty({}, 'aborted', { get() { getters++; return false; } }) },
		Object.assign({}, options, { [Symbol('extra')]: 1 })];
	try {
		for (const value of badOptions) await assert.rejects(Reflect.apply(repository.saveSmartCollection, repository, [definition(), null, value]) as Promise<unknown>);
		for (const value of [{ ...definition(), query: undefined }, { ...definition(), schemaVersion: 2 }, { ...definition(), extra: 1 },
			{ ...definition(), query: { ...definition().query, predicate: { kind: 'all', terms: sparse } } },
			{ ...definition(), query: { ...definition().query, predicate: { kind: 'all', terms } } }]) {
			await assert.rejects(repository.saveSmartCollection(value, null, options));
		}
		await assert.rejects(repository.saveSmartCollection(definition(), undefined as unknown as null, options));
		await assert.rejects(repository.deleteSmartCollection('catalog', 'saved', -1, options));
		await assert.rejects(repository.loadSmartCollection('bad/id', 'saved'));
		await assert.rejects(repository.readSmartCollectionState('catalog', { extra: 1 } as object));
		await assert.rejects(repository.readSmartCollectionPage('catalog', { continuation: undefined }));
		const stop = new AbortController(); stop.abort(17);
		await assert.rejects(repository.saveSmartCollection(definition(), null, { ...options, signal: stop.signal }), error => error === 17);
		assert.equal(opens, 0); assert.equal(getters, 0);
	} finally { await repository.close(); }
});

test('detached recipe/CAS admission precedes a held open and cancellation joins its acquisition before refusing', async () => {
	for (const cancel of [false, true]) {
		const f = await fixture(), owner = f.create(), nativeOpen = f.indexedDB.open.bind(f.indexedDB), stop = new AbortController();
		let release: (() => void) | undefined;
		f.indexedDB.open = (name, version) => {
			const pending = nativeOpen(name, version); let success: ((event: Event) => void) | null = null;
			Object.defineProperty(pending, 'onsuccess', { get: () => success, set: (handler: ((event: Event) => void) | null) => {
				success = event => { release = () => handler?.(event); };
			} }); return pending;
		};
		try {
			const candidate = definition(), captured = { ...options, signal: stop.signal };
			const promise = owner.saveSmartCollection(candidate, null, captured); let settled = false;
			void promise.then(() => { settled = true; }, () => { settled = true; });
			await new Promise<void>(resolve => setImmediate(resolve)); assert.ok(release);
			candidate.name = 'Changed after admission'; candidate.query.text = 'Different'; captured.expectedStateRevision = 9;
			if (cancel) stop.abort('held acquisition');
			await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(settled, false);
			release();
			if (cancel) { await assert.rejects(promise, error => error === 'held acquisition'); assert.equal(f.indexedDB.recordCount(DB, 'photoSmartCollections'), 0); }
			else { const saved = await promise; assert.equal(saved.definition?.name, 'Saved saved'); assert.equal(saved.definition?.query.text, 'landscape'); }
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.indexedDB.open = nativeOpen; await owner.close(); await f.repository.close(); f.database.close(); }
	}
});

test('each native put/delete failure rolls back all five authorities and a fresh retry succeeds', async () => {
	for (const operation of ['create', 'update', 'delete'] as const) {
		for (const store of stores) {
			const f = await fixture();
			try {
				if (operation !== 'create') await f.repository.saveSmartCollection(definition(), null, await f.writeOptions());
				const before = stores.map(name => f.indexedDB.records(DB, name)), expected = await f.writeOptions(), failure = new Error(`planned ${store}`);
				if (operation === 'delete' && store.startsWith('photoSmartCollection') && store !== 'photoSmartCollectionStates') f.indexedDB.failNextDeleteForStore(store, failure);
				else f.indexedDB.failNextPutForStore(store, failure);
				const run = () => operation === 'delete' ? f.repository.deleteSmartCollection('catalog', 'saved', 0, expected)
					: f.repository.saveSmartCollection({ ...definition(), name: 'New' }, operation === 'create' ? null : 0, expected);
				await assert.rejects(run(), error => error === failure);
				assert.deepEqual(stores.map(name => f.indexedDB.records(DB, name)), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
				assert.equal((await run()).state.collectionCount, operation === 'delete' ? 0 : 1);
			} finally { await f.repository.close(); f.database.close(); }
		}
	}
});

test('cancellation after the first actual native put rolls back atomically and retains opaque reasons without inspection', async () => {
	let traps = 0;
	const hostile = new Proxy({}, { getPrototypeOf() { traps++; throw new Error('reason prototype'); }, get() { traps++; throw new Error('reason getter'); } });
	for (const reason of [17, 'cancelled', null, hostile]) {
		const f = await fixture(), stop = new AbortController(), nativeTransaction = f.database.transaction.bind(f.database), before = stores.map(name => f.indexedDB.records(DB, name));
		let written = false;
		f.database.transaction = (names, mode, transactionOptions) => {
			const transaction = nativeTransaction(names, mode, transactionOptions), objectStore = transaction.objectStore.bind(transaction);
			if (mode === 'readwrite') transaction.objectStore = name => {
				const store = objectStore(name), put = store.put.bind(store);
				if (name === 'photoSmartCollections') store.put = value => {
					const pending = put(value); let success: IDBRequest['onsuccess'] = null;
					Object.defineProperty(pending, 'onsuccess', { get: () => success, set: (handler: IDBRequest['onsuccess']) => {
						success = event => { written = true; handler?.call(pending, event); stop.abort(reason); };
					} }); return pending;
				}; return store;
			}; return transaction;
		};
		try {
			// Node assert.rejects probes hostile reasons for thenability; observe exact identity without that inspection.
			let rejected = false;
			await f.repository.saveSmartCollection(definition(), null, { ...options, signal: stop.signal }).then(() => assert.fail('Expected cancellation'), error => {
				rejected = true; assert.ok(error === reason);
			}); assert.equal(rejected, true);
			assert.equal(written, true); assert.deepEqual(stores.map(name => f.indexedDB.records(DB, name)), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.database.transaction = nativeTransaction; await f.repository.close(); f.database.close(); }
	}
	assert.equal(traps, 0);
});

test('native durable create/update/delete completion wins late cancellation and caller signal shadowing', async () => {
	for (const operation of ['create', 'update', 'delete'] as const) {
		const f = await fixture(), stop = new AbortController(), nativeTransaction = f.database.transaction.bind(f.database); let getters = 0;
		try {
			if (operation !== 'create') await f.repository.saveSmartCollection(definition(), null, await f.writeOptions());
			const captured = await f.writeOptions();
			f.database.transaction = (names, mode, transactionOptions) => {
				const transaction = nativeTransaction(names, mode, transactionOptions); let completion: IDBTransaction['oncomplete'] = null;
				if (mode === 'readwrite') Object.defineProperty(transaction, 'oncomplete', { get: () => completion, set: (handler: IDBTransaction['oncomplete']) => {
					completion = event => { handler?.call(transaction, event); stop.abort(17);
						for (const key of ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener']) {
							Object.defineProperty(stop.signal, key, { get() { getters++; throw new Error('late signal shadow'); } });
						}
					};
				} }); return transaction;
			};
			const receipt = operation === 'delete' ? await f.repository.deleteSmartCollection('catalog', 'saved', 0, { ...captured, signal: stop.signal })
				: await f.repository.saveSmartCollection(definition(), operation === 'create' ? null : 0, { ...captured, signal: stop.signal });
			assert.equal(receipt.state.collectionCount, operation === 'delete' ? 0 : 1); assert.equal(getters, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.database.transaction = nativeTransaction; await f.repository.close(); f.database.close(); }
	}
});

test('explicit full load rejects stale root references and corrupt private projections while scalar paging never traverses the predicate', async () => {
	const f = await fixture(); f.seed(2);
	try {
		const document = { ...definition('saved-0001'), query: { ...definition().query, predicate: { kind: 'not', term: { kind: 'keyword', id: 'missing' } } } };
		f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1(document));
		f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(document));
		await assert.rejects(f.repository.loadSmartCollection('catalog', document.id), /reference|missing/iu);
		assert.equal((await f.repository.readSmartCollectionPage('catalog')).items.length, 2);
		f.indexedDB.seedRecord(DB, 'photoSmartCollections', { ...photoSmartCollectionRecordV1(definition('saved-0001')), referenceKeys: [] });
		await assert.rejects(f.repository.loadSmartCollection('catalog', document.id), /projection/iu);
	} finally { await f.repository.close(); f.database.close(); }
});

test('maximal legal escaped/lone-surrogate complete Query2 persists and loads without truncation', async () => {
	const f = await fixture();
	try {
		const sample = '\ud800', predicate = { kind: 'all', terms: Array.from({ length: 255 }, () => ({ kind: 'text', column: 'caption', operator: 'equals', value: sample.repeat(256) })) };
		const candidate = { ...definition(), name: sample.repeat(256), query: { ...definition().query, predicate } };
		const result = await f.repository.saveSmartCollection(candidate, null, options);
		assert.deepEqual(result.definition, normalizePhotoSmartCollectionV1(candidate));
		assert.deepEqual(await f.repository.loadSmartCollection('catalog', 'saved'), result.definition);
		assert.deepEqual((await f.repository.readSmartCollectionPage('catalog')).items.map(item => item.name), [candidate.name]);
	} finally { await f.repository.close(); f.database.close(); }
});

test('an audited context changed before final RW admission rejects without publishing the candidate or retrying', async () => {
	const f = await fixture(), nativeTransaction = f.database.transaction.bind(f.database), captured = await f.context();
	const advanced = { ...captured.root, revision: 1, name: 'Concurrent root publication' }; let writes = 0;
	f.database.transaction = (names, mode, transactionOptions) => {
		if (mode === 'readwrite') {
			writes++;
			// Inject the changed durable authority exactly between preflight and native RW admission.
			f.indexedDB.seedRecord(DB, 'catalogs', advanced); f.indexedDB.seedRecord(DB, 'catalogStates', indexState(advanced, 1));
		}
		return nativeTransaction(names, mode, transactionOptions);
	};
	try {
		await assert.rejects(f.repository.saveSmartCollection(definition(), null, options), /changed|revision/iu);
		assert.equal(writes, 1); assert.deepEqual(f.indexedDB.records(DB, 'catalogs'), [advanced]);
		assert.equal(f.indexedDB.recordCount(DB, 'photoSmartCollections'), 0); assert.equal(f.indexedDB.recordCount(DB, 'photoSmartCollectionSummaries'), 0);
		assert.equal(f.indexedDB.recordCount(DB, 'photoSmartCollectionStates'), 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.transaction = nativeTransaction; await f.repository.close(); f.database.close(); }
});

test('a second definition with valid first keys cannot bypass the private complete count/reference audit', async () => {
	for (const corruption of ['count', 'later-reference', 'later-summary', 'later-projection'] as const) {
		const f = await fixture(); f.seed(2);
		try {
			const candidate = definition('saved-0001');
			if (corruption === 'count') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 1, collectionCount: 1 });
			else if (corruption === 'later-reference') {
				const document = { ...candidate, query: { ...candidate.query, predicate: { kind: 'not', term: { kind: 'keyword', id: 'missing' } } } };
				f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1(document));
			} else if (corruption === 'later-summary') f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1({ ...candidate, name: 'Tampered' }));
			else f.indexedDB.seedRecord(DB, 'photoSmartCollections', { ...photoSmartCollectionRecordV1(candidate), referenceKeys: [] });
			const before = stores.map(name => f.indexedDB.records(DB, name));
			await assert.rejects(f.repository.saveSmartCollection(definition('new'), null, await f.writeOptions()), /count|reference|summary|projection/iu);
			assert.deepEqual(stores.map(name => f.indexedDB.records(DB, name)), before);
		} finally { await f.repository.close(); f.database.close(); }
	}
});

test('read-only summary cancellation refuses after request delivery, preserving opaque reason and joining settlement', async () => {
	const f = await fixture(); f.seed(2); const stop = new AbortController(); let probes = 0;
	const reason = new Proxy({}, { getPrototypeOf() { probes++; throw new Error('opaque prototype'); }, get() { probes++; throw new Error('opaque getter'); } });
	f.indexedDB.onNextGetForStore('photoSmartCollectionStates', () => stop.abort(reason));
	try {
		let rejected = false;
		await f.repository.readSmartCollectionPage('catalog', { signal: stop.signal }).then(() => assert.fail('Expected aborted scalar read'), error => {
			rejected = true; assert.ok(error === reason);
		});
		assert.equal(rejected, true); assert.equal(probes, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.repository.close(); f.database.close(); }
});

test('maximum legal root plus retained escaped candidate reduces audit pages and refuses an oversized draft without publication', async () => {
	const initial = queryCatalogRootV1(), keywords = [...initial.keywords.map(node => ({ ...node })),
		...Array.from({ length: 6_900 }, (_, index) => ({ id: `z-${String(index)}`, name: '界'.repeat(80), parentId: null }))];
	const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
	let remaining = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes - bytes(normalizePhotoCatalogRootV1({ ...initial, keywords }));
	for (const node of keywords.slice(1)) { const extra = Math.min(remaining, 256 - node.name.length); node.name += 'e'.repeat(extra); remaining -= extra; }
	assert.equal(remaining, 0);
	const root = normalizePhotoCatalogRootV1({ ...initial, keywords }); assert.equal(bytes(root), LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes);
	const f = await fixture(root), sample = '\ud800';
	const predicate = { kind: 'all', terms: Array.from({ length: 255 }, () => ({ kind: 'text', column: 'camera-model', operator: 'starts-with', value: sample.repeat(256) })) };
	const candidate = { ...definition(), name: sample.repeat(256), query: { ...definition().query, text: sample.repeat(256), predicate } };
	const pairs: number[] = [];
	for (let index = 0; index < 14; index++) {
		const stored = { ...candidate, id: `stored-${String(index).padStart(4, '0')}` };
		const row = photoSmartCollectionRecordV1(stored), summary = photoSmartCollectionSummaryRecordV1(stored);
		f.indexedDB.seedRecord(DB, 'photoSmartCollections', row); f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', summary);
		pairs.push(bytes(row) + bytes(summary));
	}
	f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 1, collectionCount: 14 });
	const captured = await f.context(), expected = await f.writeOptions(), pages: number[] = [];
	function observeRoot() { pages.push(0); f.indexedDB.onNextGetForStore('catalogs', observeRoot); }
	function observeDefinition() { pages[pages.length - 1]!++; f.indexedDB.onNextGetForStore('photoSmartCollections', observeDefinition); }
	f.indexedDB.onNextGetForStore('catalogs', observeRoot); f.indexedDB.onNextGetForStore('photoSmartCollections', observeDefinition);
	try {
		const admitted = normalizePhotoSmartCollectionV1(candidate), retainedBytes = bytes(admitted);
		assert.ok(retainedBytes > 400_000);
		const receipt = await f.repository.saveSmartCollection(candidate, null, expected);
		const base = bytes(root) * 2 + bytes(captured.index) + bytes(captured.state) + retainedBytes
			+ PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.reservedScalarBytes;
		const maximumPair = PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + 4096;
		const maximumPerPage = Math.floor((PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.maximumPageBytes - base - maximumPair) / Math.max(...pairs)) + 1;
		assert.equal(maximumPerPage, 5); assert.equal(Math.max(...pages), maximumPerPage);
		assert.ok(pages.every(count => base + count * Math.max(...pairs) <= PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.maximumPageBytes));
		assert.equal(pages.reduce((total, count) => total + count, 0), 15); // Fourteen audited records plus the final target absence lookup.
		assert.equal(receipt.state.collectionCount, 15); assert.deepEqual(receipt.definition, admitted);
		const before = stores.map(name => f.indexedDB.records(DB, name));
		const oversized = { ...candidate, query: { ...candidate.query, predicate: { kind: 'all', terms: [...predicate.terms,
			{ kind: 'text', column: 'camera-model', operator: 'starts-with', value: sample.repeat(256) }] } } };
		await assert.rejects(f.repository.saveSmartCollection(oversized, null, await f.writeOptions()), /node|budget/iu);
		assert.deepEqual(stores.map(name => f.indexedDB.records(DB, name)), before);
		await assert.rejects(f.repository.saveSmartCollection(candidate, null, expected), /changed|revision/iu);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await f.repository.close(); f.database.close(); }
});
