/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { saveCatalog } from '../src/lightscaper/catalog/repository-writes.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { indexState, photoMemberships, photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { AUDIT_DATABASE, auditDefinitionV1, auditMaximumRootV1, auditRootV1, auditStateV1, smartCollectionAuditFixtureV1 } from './helpers/lightscaper-smart-collection-audit-fixture.ts';

test('root saves refuse saved scope and false-branch references before any durable mutation', async () => {
	for (const kind of ['folder', 'keyword', 'collection'] as const) {
		const f = await smartCollectionAuditFixtureV1();
		const definition = { ...auditDefinitionV1(), query: { schemaVersion: 2, kind: 'photo-catalog-query',
			filter: kind === 'collection' ? { kind, id: 'manual' } : null,
			predicate: { kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 },
				{ kind: 'not', term: { kind: kind === 'collection' ? 'keyword' : kind, id: kind === 'collection' ? 'keyword' : kind } }] } } };
		f.seed(definition); f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', auditStateV1(1));
		const before = f.snapshot();
		const candidate = normalizePhotoCatalogRootV1({ ...f.root,
			...(kind === 'folder' ? { folders: [] } : kind === 'keyword' ? { keywords: [] } : { collections: [] }) });
		try { await assert.rejects(saveCatalog(f.database, candidate, 0), /reference|missing/iu); assert.deepEqual(f.snapshot(), before); }
		finally { f.close(); }
	}
});

test('a negative reference index cannot authorize deletion when the full projection is corrupt', async () => {
	const f = await smartCollectionAuditFixtureV1(1);
	const row = photoSmartCollectionRecordV1(auditDefinitionV1());
	f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollections', { ...row, referenceKeys: [] });
	const before = f.snapshot();
	try {
		await assert.rejects(saveCatalog(f.database, { ...f.root, keywords: [] }, 0), /projection/iu);
		assert.deepEqual(f.snapshot(), before);
	} finally { f.close(); }
});

test('later-page saved IDs and the combined collection count remain authoritative', async () => {
	const f = await smartCollectionAuditFixtureV1(75);
	try {
		const before = f.snapshot();
		await assert.rejects(saveCatalog(f.database, { ...f.root, collections: [...f.root.collections,
			{ id: auditDefinitionV1(74).id, name: 'Collision', kind: 'manual' }] }, 0), /collection.*ID|disjoint|collision/iu);
		assert.deepEqual(f.snapshot(), before);
		const candidate = { ...f.root, collections: Array.from({ length: 9_926 }, (_, index) => ({ id: `root-${String(index)}`, name: 'Root', kind: 'manual' as const })) };
		await assert.rejects(saveCatalog(f.database, candidate, 0), /10000|combined|budget/iu);
		assert.deepEqual(f.snapshot(), before);
	} finally { f.close(); }
});

test('safe root edits preserve every photo/source/query/saved row and increment only root and index', async () => {
	const initial = { ...auditRootV1(), photoCount: 1 }, f = await smartCollectionAuditFixtureV1(3, initial), photo = queryPhotoV1();
	f.indexedDB.seedRecord(AUDIT_DATABASE, 'photos', { key: photoStorageKey('catalog', photo.id), document: photo });
	f.indexedDB.seedRecord(AUDIT_DATABASE, 'summaries', photoSummary(photo));
	for (const membership of photoMemberships(photo)) f.indexedDB.seedRecord(AUDIT_DATABASE, 'memberships', membership);
	const before = f.snapshot().filter(([store]) => !['catalogs', 'catalogStates'].includes(store));
	try {
		const saved = await saveCatalog(f.database, { ...initial, name: 'Renamed' }, 0);
		assert.equal(saved.revision, 1); assert.equal(saved.photoCount, 1); assert.equal(saved.name, 'Renamed');
		assert.deepEqual(f.snapshot().filter(([store]) => !['catalogs', 'catalogStates'].includes(store)), before);
		assert.deepEqual(f.indexedDB.records(AUDIT_DATABASE, 'catalogStates'), [indexState(saved, 9)]);
	} finally { f.close(); }
});

test('existing photo-membership removal guards still roll back with no saved definitions', async () => {
	for (const field of ['folders', 'keywords', 'collections'] as const) {
		const initial = { ...auditRootV1(), photoCount: 1 }, f = await smartCollectionAuditFixtureV1(0, initial), photo = queryPhotoV1();
		for (const membership of photoMemberships(photo)) f.indexedDB.seedRecord(AUDIT_DATABASE, 'memberships', membership);
		const before = f.snapshot();
		try { await assert.rejects(saveCatalog(f.database, { ...initial, [field]: [] }, 0), /referenced by photos/iu); assert.deepEqual(f.snapshot(), before); }
		finally { f.close(); }
	}
});

test('summary drift and inaccurate counts refuse even when context first keys pair', async () => {
	for (const corruption of ['summary', 'count', 'extra-summary'] as const) {
		const f = await smartCollectionAuditFixtureV1(2);
		if (corruption === 'summary') f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionSummaries',
			photoSmartCollectionSummaryRecordV1({ ...auditDefinitionV1(1), name: 'Different' }));
		if (corruption === 'count') f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', auditStateV1(1));
		if (corruption === 'extra-summary') f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(auditDefinitionV1(2)));
		const before = f.snapshot();
		try { await assert.rejects(saveCatalog(f.database, { ...f.root, name: 'Refused' }, 0)); assert.deepEqual(f.snapshot(), before); }
		finally { f.close(); }
	}
});

test('final RW rechecks root, index and saved-state after successful canonical preflight', async () => {
	for (const drift of ['root', 'index', 'state'] as const) {
		const f = await smartCollectionAuditFixtureV1(1), nativeTransaction = f.database.transaction.bind(f.database);
		f.database.transaction = (stores, mode, options) => {
			if (mode === 'readwrite') {
				if (drift === 'root') f.indexedDB.seedRecord(AUDIT_DATABASE, 'catalogs', { ...f.root, name: 'Concurrent corruption' });
				if (drift === 'index') f.indexedDB.seedRecord(AUDIT_DATABASE, 'catalogStates', indexState(f.root, 9));
				if (drift === 'state') f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', auditStateV1(1, 8));
			}
			return nativeTransaction(stores, mode, options);
		};
		try {
			await assert.rejects(saveCatalog(f.database, { ...f.root, name: 'Never saved' }, 0), /revision|conflict/iu);
			assert.equal(f.indexedDB.records(AUDIT_DATABASE, 'catalogs')[0]?.revision, 0);
			assert.notEqual(f.indexedDB.records(AUDIT_DATABASE, 'catalogs')[0]?.name, 'Never saved');
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.close(); }
	}
});

test('a completed root publication retains its durable acknowledgment after late cancellation', async () => {
	const f = await smartCollectionAuditFixtureV1(1), stop = new AbortController(), nativeTransaction = f.database.transaction.bind(f.database);
	f.database.transaction = (stores, mode, options) => {
		const transaction = nativeTransaction(stores, mode, options);
		if (mode === 'readwrite') {
			let completion: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(transaction, 'oncomplete', { configurable: true,
				get: () => completion,
				set: (handler: IDBTransaction['oncomplete']) => { completion = event => { handler?.call(transaction, event); stop.abort(17); }; } });
		}
		return transaction;
	};
	try {
		const saved = await saveCatalog(f.database, { ...f.root, name: 'Durable' }, 0, stop.signal);
		assert.equal(saved.revision, 1); assert.equal(saved.name, 'Durable'); assert.equal(stop.signal.reason, 17);
		assert.deepEqual(f.indexedDB.records(AUDIT_DATABASE, 'catalogs'), [saved]);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.close(); }
});

test('maximum legal root saves preserve byte admission and reject a frozen unbranded oversized candidate', async () => {
	const root = auditMaximumRootV1(), f = await smartCollectionAuditFixtureV1(1, root);
	try {
		const oversized = normalizePhotoCatalogRootV1({ ...root, name: `${root.name}x` });
		await assert.rejects(saveCatalog(f.database, oversized, 0), /byte budget/iu);
		assert.equal(f.indexedDB.stats.getRequests.length, 0);
		const saved = await saveCatalog(f.database, root, 0);
		assert.equal(saved.revision, 1); assert.equal(new TextEncoder().encode(JSON.stringify(saved)).byteLength, 2_097_152);
		assert.deepEqual(saved.keywords, root.keywords); assert.deepEqual(saved.collections, root.collections);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.close(); }
});
