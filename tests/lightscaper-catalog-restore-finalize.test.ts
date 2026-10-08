/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizePhotoCatalogRestoreCandidateV1, type PhotoCatalogRestoreFinalizeContextV1 } from '../src/lightscaper/catalog/photo-catalog-restore-finalize-v1.ts';
import { photoCatalogRestoreRootRecordsV1, photoCatalogRestorePhotoRecordsV1, photoCatalogRestoreStackRecordsV1,
	photoCatalogRestoreSavedCollectionRecordsV1 } from '../src/lightscaper/catalog/photo-catalog-restore-records-v1.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { smartCollectionDefinitionV1 } from './helpers/lightscaper-smart-collection-repository-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { catalogTransaction } from '../src/lightscaper/catalog/catalog-transaction.ts';
import { request } from '../src/common/editor/storage/indexeddb-backend.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { auditPhotoCatalogRestoreStoreV1 } from '../src/lightscaper/catalog/photo-catalog-restore-audit-pages-v1.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const DB = 'restore-finalize';
async function fixture(photoCount = 2, savedCount = 1, savedRevision: number | null = 73) {
	const indexedDB = createInstrumentedIndexedDB(), database = await openPhotoCatalogDatabaseV1(indexedDB as unknown as IDBFactory, DB, () => undefined);
	const initial = photoCatalogRestoreRootRecordsV1({ ...queryCatalogRootV1(), revision: 91, photoCount }, savedRevision === null ? null
		: { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: savedRevision, collectionCount: savedCount });
	const seed = (store: string, value: unknown, key?: IDBValidKey) => indexedDB.seedRecord(DB, store, value, key);
	seed('catalogs', initial.root); seed('catalogStates', initial.index); seed('photoStackStates', initial.stackState);
	seed('photoQueryBuildStates', initial.queryBuildV1); seed('photoQueryBuildStatesV2', initial.queryBuildV2);
	if (initial.savedState !== null) seed('photoSmartCollectionStates', initial.savedState);
	const delivered = new Map<string, string>(), checked: string[] = [];
	for (let i = 0; i < photoCount; i++) {
		const rows = photoCatalogRestorePhotoRecordsV1(initial.root, { ...queryPhotoV1(i), revision: 101 + i });
		seed('photos', rows.photo); seed('summaries', rows.summary); seed('photoQueryRowsV2', rows.queryV2);
		if (rows.queryV1 !== null) seed('photoQueryRows', rows.queryV1);
		for (const row of rows.memberships) seed('memberships', row);
		delivered.set(`photo:${rows.photo.document.id}`, JSON.stringify(rows.photo.document));
	}
	const stackCount = photoCount >= 2 ? 1 : 0;
	if (stackCount) {
		const rows = photoCatalogRestoreStackRecordsV1(initial.root, { schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'stack',
			revision: 137, photoIds: ['photo-000001', 'photo-000000'], coverPhotoId: 'photo-000000' });
		seed('photoStacks', rows.stack); for (const row of rows.memberships) seed('photoStackMemberships', row);
		delivered.set(`stack:${rows.stack.document.id}`, JSON.stringify(rows.stack.document));
	}
	for (let i = 0; i < savedCount; i++) {
		const rows = photoCatalogRestoreSavedCollectionRecordsV1(initial.root, { ...smartCollectionDefinitionV1(`saved-${String(i).padStart(4, '0')}`), revision: 151 + i });
		seed('photoSmartCollections', rows.definition); seed('photoSmartCollectionSummaries', rows.summary);
		delivered.set(`saved:${rows.definition.document.id}`, JSON.stringify(rows.definition.document));
	}
	const context: PhotoCatalogRestoreFinalizeContextV1 = { root: initial.root, savedState: initial.savedState, photoCount, stackCount,
		savedCollectionCount: savedCount, legacyQueryIndexedCount: photoCount, assertDelivered(kind, document) {
			const key = `${kind}:${document.id}`; assert.equal(JSON.stringify(document), delivered.get(key), 'delivered canonical identity'); checked.push(key);
		} };
	const contents = () => PHOTO_CATALOG_STORES.map(store => indexedDB.records(DB, store));
	return { indexedDB, database, initial, context, seed, contents, checked };
}

test('candidate readiness authenticates all three archived kinds and preserves revisions and physical state', async () => {
	const f = await fixture(130, 130);
	try {
		await finalizePhotoCatalogRestoreCandidateV1(f.database, f.context);
		assert.equal(f.checked.length, 261); assert.equal(new Set(f.checked).size, 261);
		assert.deepEqual(f.indexedDB.records(DB, 'catalogs'), [f.initial.root]);
		assert.deepEqual(f.indexedDB.records(DB, 'photoSmartCollectionStates'), [f.initial.savedState]);
		assert.deepEqual(f.indexedDB.records(DB, 'photoQueryBuildStatesV2'), [{ id: 'catalog', schemaVersion: 2, ready: true, afterKey: null, indexedCount: 130 }]);
		assert.deepEqual(f.indexedDB.records(DB, 'photoQueryBuildStates'), [{ id: 'catalog', schemaVersion: 1, ready: true, afterKey: null, indexedCount: 130 }]);
		assert.deepEqual(f.indexedDB.records(DB, 'photoStackStates'), [{ schemaVersion: 1, kind: 'photo-stack-state', catalogId: 'catalog', revision: 0, stackCount: 1 }]);
		assert.equal(f.indexedDB.stats.cursorRequests.length, 0); assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
		assert.ok(f.indexedDB.stats.keyCursorRequests.every((row: Readonly<{ delivered: number }>) => row.delivered <= 64));
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.close(); }
});

test('absent saved state and retained empty tombstones remain physically distinct after readiness', async () => {
	for (const revision of [null, 0, Number.MAX_SAFE_INTEGER]) {
		const f = await fixture(0, 0, revision);
		try { await finalizePhotoCatalogRestoreCandidateV1(f.database, f.context);
			assert.deepEqual(f.indexedDB.records(DB, 'photoSmartCollectionStates'), revision === null ? [] : [f.initial.savedState]);
		} finally { f.database.close(); }
	}
});

test('bounded key pages refuse oversized physical primary keys before retaining or visiting them', async () => {
	for (const store of PHOTO_CATALOG_STORES) {
		const f = await fixture(0, 0, null);
		try {
			f.seed(store, { id: 'oversized', key: 'oversized' }, 'x'.repeat(1_024));
			let visited = 0;
			await assert.rejects(auditPhotoCatalogRestoreStoreV1(f.database, store, () => { visited++; }), /key.*budget/iu);
			assert.equal(visited, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.database.close(); }
	}
});

test('key inventory stops at expected-count plus one rather than scanning arbitrary extra rows', async () => {
	const f = await fixture(0, 0, null);
	try {
		for (let i = 0; i < 130; i++) f.seed('photos', {}, `catalog|photo-${String(i).padStart(6, '0')}`);
		let visited = 0;
		await assert.rejects(auditPhotoCatalogRestoreStoreV1(f.database, 'photos', () => { visited++; }, undefined, 1), /inventory.*count/iu);
		assert.equal(visited, 0);
		assert.equal(f.indexedDB.stats.keyCursorRequests.reduce((total: number, row: Readonly<{ delivered: number }>) => total + row.delivered, 0), 2);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.close(); }
});

test('key pages reject non-ASCII physical keys before visitors can retain them', async () => {
	const f = await fixture(0, 0, null);
	try {
		f.seed('photos', {}, '界'.repeat(64)); let visited = 0;
		await assert.rejects(auditPhotoCatalogRestoreStoreV1(f.database, 'photos', () => { visited++; }), /key.*ASCII/iu);
		assert.equal(visited, 0);
	} finally { f.database.close(); }
});

for (const store of PHOTO_CATALOG_STORES) test(`global inventory refuses foreign ${store} rows without changing readiness`, async () => {
	const f = await fixture();
	try {
		f.seed(store, { id: 'foreign', catalogId: 'foreign', key: 'foreign' }, 'foreign');
		const before = f.contents(); await assert.rejects(finalizePhotoCatalogRestoreCandidateV1(f.database, f.context));
		assert.deepEqual(f.contents(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.close(); }
});

for (const side of ['summaries', 'photoQueryRows', 'photoQueryRowsV2', 'memberships', 'photoStackMemberships', 'photoSmartCollectionSummaries'] as const) {
	test(`forward audit refuses missing ${side} even when reverse inventory remains otherwise valid`, async () => {
		const f = await fixture(130, 130);
		try {
			const row = f.indexedDB.records(DB, side).at(-1) as { key: string };
			await catalogTransaction(f.database, [side], 'readwrite', async stores => { await request(stores[side].delete(row.key)); });
			const before = f.contents(); await assert.rejects(finalizePhotoCatalogRestoreCandidateV1(f.database, f.context));
			assert.deepEqual(f.contents(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.database.close(); }
	});
}

test('later-page coherent photo and saved rewrites cannot replace delivered same-revision canonical documents', async () => {
	for (const kind of ['photo', 'saved'] as const) {
		const f = await fixture(130, 130);
		try {
			if (kind === 'photo') {
				const source = queryPhotoV1(129), rows = photoCatalogRestorePhotoRecordsV1(f.initial.root,
					{ ...source, revision: 230, metadata: { ...source.metadata, title: 'Coherent replacement' } });
				f.seed('photos', rows.photo); f.seed('summaries', rows.summary); f.seed('photoQueryRows', rows.queryV1); f.seed('photoQueryRowsV2', rows.queryV2);
			} else {
				const source = smartCollectionDefinitionV1('saved-0129'), rows = photoCatalogRestoreSavedCollectionRecordsV1(f.initial.root,
					{ ...source, revision: 280, query: { ...source.query, text: 'Coherent replacement' } });
				f.seed('photoSmartCollections', rows.definition); f.seed('photoSmartCollectionSummaries', rows.summary);
			}
			const before = f.contents(); await assert.rejects(finalizePhotoCatalogRestoreCandidateV1(f.database, f.context), /delivered canonical identity/u);
			assert.deepEqual(f.contents(), before);
		} finally { f.database.close(); }
	}
});

test('saved admission refuses defaulted Query2 fields and missing references in inactive branches', async () => {
	for (const corruption of ['incomplete', 'hidden-reference'] as const) {
		const f = await fixture();
		try {
			const source = smartCollectionDefinitionV1('saved-0000');
			if (corruption === 'incomplete') {
				const raw = photoSmartCollectionRecordV1({ ...source, revision: 151 });
				const query: Record<string, unknown> = { ...raw.document.query }; delete query.predicate;
				f.seed('photoSmartCollections', { ...raw, document: { ...raw.document, query } });
			} else {
				const raw = photoSmartCollectionRecordV1({ ...source, revision: 151, query: { ...source.query, predicate: { kind: 'any', terms: [
					{ kind: 'rating', minimum: 0, maximum: 5 }, { kind: 'not', term: { kind: 'folder', id: 'missing' } },
				] } } });
				f.seed('photoSmartCollections', raw); f.seed('photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(raw.document));
			}
			const before = f.contents(); await assert.rejects(finalizePhotoCatalogRestoreCandidateV1(f.database, f.context)); assert.deepEqual(f.contents(), before);
		} finally { f.database.close(); }
	}
});

test('final control fence refuses same-revision root drift during earlier source audit', async () => {
	const f = await fixture();
	try {
		f.indexedDB.onNextGetForStore('photos', () => f.seed('catalogs', { ...f.initial.root, name: 'Changed during audit' }));
		await assert.rejects(finalizePhotoCatalogRestoreCandidateV1(f.database, f.context));
		assert.equal((f.indexedDB.records(DB, 'photoQueryBuildStatesV2')[0] as { ready: boolean }).ready, false);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.close(); }
});

test('final all-store count fence catches a late inserted row after its key inventory finished', async () => {
	const f = await fixture();
	try {
		f.indexedDB.onNextGetForStore('photoSmartCollections', () => f.seed('memberships', {
			key: 'catalog|rating|0|extra', scope: 'catalog|rating|0', photoKey: 'catalog|extra',
		}));
		await assert.rejects(finalizePhotoCatalogRestoreCandidateV1(f.database, f.context), /inventory changed before readiness/u);
		assert.equal((f.indexedDB.records(DB, 'photoQueryBuildStatesV2')[0] as { ready: boolean }).ready, false);
	} finally { f.database.close(); }
});

test('failure of the last readiness write rolls back both query controls and derived stack state', async () => {
	const f = await fixture(), failure = new Error('final state write failed');
	try {
		const before = f.contents(); f.indexedDB.failNextPutForStore('photoStackStates', failure);
		await assert.rejects(finalizePhotoCatalogRestoreCandidateV1(f.database, f.context), error => error === failure);
		assert.deepEqual(f.contents(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.close(); }
});

test('one rich photo audits2051 memberships without repeated document reads or empty per-key transactions', async () => {
	const f = await fixture(0, 0, null), native = f.database.transaction.bind(f.database);
	try {
		const ids = (prefix: string) => Array.from({ length: 1_024 }, (_, i) => `${prefix}${String(i).padStart(4, '0')}${'x'.repeat(123)}`);
		const keywords = ids('k'), collections = ids('c');
		const initial = photoCatalogRestoreRootRecordsV1({ ...f.initial.root, id: 'c'.repeat(128), photoCount: 1, folders: [],
			keywords: keywords.map(id => ({ id, name: 'Keyword', parentId: null })),
			collections: collections.map(id => ({ id, name: 'Manual', kind: 'manual' })) }, null);
		// Replace the original empty control scope with the archived long-identity scope.
		for (const store of ['catalogs', 'catalogStates', 'photoStackStates', 'photoQueryBuildStates', 'photoQueryBuildStatesV2']) {
			await catalogTransaction(f.database, [store], 'readwrite', async stores => { await request(stores[store].delete('catalog')); });
		}
		f.seed('catalogs', initial.root); f.seed('catalogStates', initial.index); f.seed('photoStackStates', initial.stackState);
		f.seed('photoQueryBuildStates', initial.queryBuildV1); f.seed('photoQueryBuildStatesV2', initial.queryBuildV2);
		const base = queryPhotoV1(), words = '\ud800'.repeat(16_384), camera = '\ud800'.repeat(1_024);
		const rows = photoCatalogRestorePhotoRecordsV1(initial.root, { ...base, catalogId: initial.root.id, id: 'p'.repeat(128), folderId: null,
			keywordIds: keywords, collectionIds: collections, metadata: { ...base.metadata, fileName: 'x'.repeat(256), cameraMake: camera,
				cameraModel: camera, lens: camera, title: words, caption: words, creator: words, copyright: words, location: words } });
		assert.equal(rows.queryV1, null); assert.equal(rows.memberships.length, 2_051);
		f.seed('photos', rows.photo); f.seed('summaries', rows.summary); f.seed('photoQueryRowsV2', rows.queryV2);
		for (const row of rows.memberships) f.seed('memberships', row);
		let transactions = 0, delivered = 0;
		f.database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => { transactions++; return native(...args); }) as IDBDatabase['transaction'];
		const context: PhotoCatalogRestoreFinalizeContextV1 = { root: initial.root, savedState: null, photoCount: 1, stackCount: 0,
			savedCollectionCount: 0, legacyQueryIndexedCount: 0, assertDelivered(kind, document) { assert.equal(kind, 'photo'); assert.deepEqual(document, rows.photo.document); delivered++; } };
		await finalizePhotoCatalogRestoreCandidateV1(f.database, context);
		assert.equal(delivered, 1); assert.equal(f.indexedDB.stats.getRequests.filter((row: Readonly<{ store: string }>) => row.store === 'photos').length, 1);
		assert.ok(transactions < 100, `bounded key pages and one source transaction: ${transactions}`);
		assert.deepEqual(f.indexedDB.records(DB, 'photoQueryBuildStates'), [{ ...initial.queryBuildV1, ready: false, indexedCount: 0 }]);
		assert.deepEqual(f.indexedDB.records(DB, 'photoQueryBuildStatesV2'), [{ ...initial.queryBuildV2, ready: true, indexedCount: 1 }]);
	} finally { f.database.transaction = native; f.database.close(); }
});

test('pre-audit and admitted opaque cancellation join transactions and leave readiness pending', async () => {
	let inspections = 0;
	const hostile = new Proxy({}, { get() { inspections++; throw new Error('opaque'); }, getPrototypeOf() { inspections++; throw new Error('opaque'); } });
	for (const reason of [17, null, hostile]) for (const admitted of [false, true]) {
		const f = await fixture(), controller = new AbortController();
		try {
			if (admitted) f.indexedDB.onNextGetForStore('photos', () => controller.abort(reason)); else controller.abort(reason);
			const before = f.contents();
			await finalizePhotoCatalogRestoreCandidateV1(f.database, f.context, controller.signal).then(() => assert.fail('Expected cancellation'), error => assert.ok(error === reason));
			assert.deepEqual(f.contents(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.database.close(); }
	}
	assert.equal(inspections, 0);
});

test('completed native readiness ACK survives cancellation before its held success callback is delivered', async () => {
	const f = await fixture(), controller = new AbortController(), native = f.database.transaction.bind(f.database);
	let release: (() => void) | undefined, announce!: () => void;
	const completed = new Promise<void>(resolve => { announce = resolve; });
	f.database.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const transaction = native(names, mode);
		if (mode === 'readwrite') Object.defineProperty(transaction, 'oncomplete', { configurable: true,
			set(callback: ((event: Event) => void) | null) { Object.defineProperty(transaction, 'oncomplete', { configurable: true,
				value: (event: Event) => { release = () => callback?.call(transaction, event); announce(); } }); } });
		return transaction;
	}) as IDBDatabase['transaction'];
	try {
		let settled = false;
		const operation = finalizePhotoCatalogRestoreCandidateV1(f.database, f.context, controller.signal).finally(() => { settled = true; });
		await completed; assert.equal(settled, false); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		controller.abort(17); release!(); await operation;
		assert.equal((f.indexedDB.records(DB, 'photoQueryBuildStatesV2')[0] as { ready: boolean }).ready, true);
	} finally { f.database.transaction = native; f.database.close(); }
});
