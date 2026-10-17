/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePhotoSmartCollectionArchiveV1 } from '../src/lightscaper/catalog/photo-smart-collection-archive-capture-v1.ts';
import { assertPhotoSmartCollectionStorageAuditV1 } from '../src/lightscaper/catalog/photo-smart-collection-audit-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { indexState } from '../src/lightscaper/catalog/repository-records.ts';
import { catalogTransaction } from '../src/lightscaper/catalog/catalog-transaction.ts';
import { request } from '../src/common/editor/storage/indexeddb-backend.ts';
import { AUDIT_DATABASE as DB, auditDefinitionV1 as definition, auditMaximumRootV1, auditStateV1 as state,
	smartCollectionAuditFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-audit-fixture.ts';

test('capture preserves physical null, revision-zero empty state and retained tombstone without write authority', async () => {
	for (const retained of [null, state(0, 0), state(0, 37)]) {
		const f = await fixture();
		try {
			if (retained !== null) f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', retained);
			const before = f.snapshot(), source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog');
			assert.deepEqual(source.context, { schemaVersion: 1, kind: 'photo-smart-collection-archive-context',
				catalogId: 'catalog', catalogRevision: 0, indexRevision: 8, state: retained });
			assert.ok(Object.isFrozen(source)); assert.ok(Object.isFrozen(source.context));
			assert.deepEqual(Object.keys(source), ['context', 'definitions', 'verify']);
			const context = await f.context();
			assert.throws(() => assertPhotoSmartCollectionStorageAuditV1(source, f.database, context, f.root));
			for await (const _record of source.definitions) assert.fail('Empty scope yielded a recipe.');
			await source.verify(); assert.deepEqual(f.snapshot(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.close(); }
	}
});

test('seventy complete recipes stream in primary order with no inventory array or open transaction across yield', async () => {
	const f = await fixture(70);
	try {
		const before = f.snapshot(), source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog');
		let count = 0;
		for await (const value of source.definitions) {
			assert.deepEqual(value, normalizePhotoSmartCollectionV1(definition(count)));
			assert.ok(Object.isFrozen(value.query)); assert.equal(f.indexedDB.stats.activeTransactions, 0); count++;
		}
		assert.equal(count, 70); await source.verify(); assert.deepEqual(f.snapshot(), before);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
		assert.equal(f.indexedDB.stats.cursorRequests.length, 0);
		assert.ok(f.indexedDB.stats.keyCursorRequests.every((page: Readonly<{ delivered: number }>) => page.delivered <= 64));
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.close(); }
});

test('initial audit refuses hidden orphans, indexed foreign rows, count lies and absent-state primary corruption', async () => {
	for (const corruption of ['orphan-definition', 'orphan-summary', 'foreign-index', 'count', 'empty-hidden'] as const) {
		const f = await fixture(corruption === 'empty-hidden' ? 0 : 2);
		try {
			const extra = definition(2);
			if (corruption === 'orphan-definition') f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1(extra));
			if (corruption === 'orphan-summary') f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(extra));
			if (corruption === 'foreign-index') f.indexedDB.seedRecord(DB, 'photoSmartCollections', { ...photoSmartCollectionRecordV1(extra), key: '["foreign","saved"]' });
			if (corruption === 'count') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', state(3));
			if (corruption === 'empty-hidden') {
				f.indexedDB.seedRecord(DB, 'photoSmartCollections', { ...photoSmartCollectionRecordV1(extra), catalogId: 'foreign' });
				f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', { ...photoSmartCollectionSummaryRecordV1(extra), catalogId: 'foreign' });
			}
			const before = f.snapshot(); await assert.rejects(capturePhotoSmartCollectionArchiveV1(f.database, 'catalog'));
			assert.deepEqual(f.snapshot(), before); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.close(); }
	}
});

test('every false predicate branch, filter reference and root/saved identity is authenticated before capture', async () => {
	for (const query of [
		{ ...definition().query, predicate: { kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 }, { kind: 'not', term: { kind: 'keyword', id: 'missing' } }] } },
		{ ...definition().query, filter: { kind: 'collection', id: 'missing' } },
		{ ...definition().query, predicate: { kind: 'all', terms: [{ kind: 'rating', minimum: 5, maximum: 5 }, { kind: 'folder', id: 'missing' }] } },
	]) {
		const f = await fixture(1);
		try { f.seed({ ...definition(), query }); await assert.rejects(capturePhotoSmartCollectionArchiveV1(f.database, 'catalog'), /reference|missing/iu); }
		finally { f.close(); }
	}
	const f = await fixture(1);
	try { f.seed({ ...definition(), id: 'manual' }); await assert.rejects(capturePhotoSmartCollectionArchiveV1(f.database, 'catalog'), /disjoint|count/iu); }
	finally { f.close(); }
});

test('archive audit refuses stored incomplete FullQuery2 fields instead of manufacturing defaults', async () => {
	for (const key of ['text', 'filter', 'sort', 'predicate']) {
		const f = await fixture(1);
		try {
			const row = photoSmartCollectionRecordV1({ ...definition(), query: { ...definition().query, filter: null, predicate: null } });
			const query: Record<string, unknown> = { ...row.document.query }; delete query[key];
			f.indexedDB.seedRecord(DB, 'photoSmartCollections', { ...row, document: { ...row.document, query } });
			await assert.rejects(capturePhotoSmartCollectionArchiveV1(f.database, 'catalog'), /complete|required/iu);
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.close(); }
	}
});

test('root/index/state and physical presence are checked on each audit phase and page', async () => {
	for (const drift of ['root', 'index', 'state', 'presence'] as const) {
		const f = await fixture(drift === 'presence' ? 0 : 30); let reads = 0;
		try {
			function observe() {
				if (++reads === 3) {
					if (drift === 'root') f.indexedDB.seedRecord(DB, 'catalogs', { ...f.root, name: 'Unversioned change' });
					if (drift === 'index') f.indexedDB.seedRecord(DB, 'catalogStates', indexState(f.root, 9));
					if (drift === 'state') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', state(30, 8));
					if (drift === 'presence') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', state(0, 0));
				} else f.indexedDB.onNextGetForStore('catalogs', observe);
			}
			f.indexedDB.onNextGetForStore('catalogs', observe);
			await assert.rejects(capturePhotoSmartCollectionArchiveV1(f.database, 'catalog'), /revision|changed|conflict/iu);
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.close(); }
	}
});

test('same-revision recipe changes between initial audit and delivery cannot become a successful archive', async () => {
	const f = await fixture(2);
	try {
		const source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog');
		f.seed({ ...definition(1), query: { ...definition(1).query, text: 'different criteria' } });
		await assert.rejects(async () => { for await (const _recipe of source.definitions) { /* Drain without retaining recipes. */ } }, /changed|digest|snapshot/iu);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.close(); }
});

test('final full audit catches same-revision payload, hidden orphan and false-reference changes after delivery', async () => {
	for (const corruption of ['payload', 'orphan', 'false-reference', 'summary', 'presence'] as const) {
		const f = await fixture(corruption === 'presence' ? 0 : 2);
		try {
			const source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog');
			for await (const _recipe of source.definitions) { /* No full-query inventory. */ }
			if (corruption === 'payload') f.seed({ ...definition(1), query: { ...definition(1).query, text: 'late criteria' } });
			if (corruption === 'orphan') f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1(definition(2)));
			if (corruption === 'false-reference') f.seed({ ...definition(1), query: { ...definition(1).query,
				predicate: { kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 }, { kind: 'keyword', id: 'missing' }] } } });
			if (corruption === 'summary') f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1({ ...definition(1), name: 'Mismatch' }));
			if (corruption === 'presence') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', state(0, 0));
			await assert.rejects(source.verify()); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { f.close(); }
	}
});

test('final verification refuses undelivered recipes and a removed physical empty tombstone', async () => {
	const f = await fixture(2);
	try {
		const source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog'), iterator = source.definitions[Symbol.asyncIterator]();
		await iterator.next(); await iterator.return?.(); await assert.rejects(source.verify(), /count|incomplete|delivered/iu);
	} finally { f.close(); }
	const empty = await fixture();
	try {
		empty.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', state(0, 0));
		const source = await capturePhotoSmartCollectionArchiveV1(empty.database, 'catalog');
		await catalogTransaction(empty.database, ['photoSmartCollectionStates'], 'readwrite', async stores => { await request(stores.photoSmartCollectionStates.delete('catalog')); });
		await assert.rejects(source.verify(), /revision|changed|conflict/iu);
	} finally { empty.close(); }
});

test('maximum-root escaped recipes keep every native audit page under8MiB and64 key deliveries', async () => {
	const root = auditMaximumRootV1(), f = await fixture(0, root);
	const recipes = 14, pages: number[] = [], pairBytes: number[] = [];
	try {
		for (let index = 0; index < recipes; index++) {
			const value = { ...definition(index), query: { schemaVersion: 2, kind: 'photo-catalog-query', predicate: { kind: 'all',
				terms: Array.from({ length: 255 }, () => ({ kind: 'text', column: 'caption', operator: 'equals', value: '\ud800'.repeat(256) })) } } };
			f.seed(value); pairBytes.push(new TextEncoder().encode(JSON.stringify(photoSmartCollectionRecordV1(value))).byteLength
				+ new TextEncoder().encode(JSON.stringify(photoSmartCollectionSummaryRecordV1(value))).byteLength);
		}
		f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', state(recipes));
		function observeRoot() { pages.push(0); f.indexedDB.onNextGetForStore('catalogs', observeRoot); }
		function observeDefinition() { pages[pages.length - 1]!++; f.indexedDB.onNextGetForStore('photoSmartCollections', observeDefinition); }
		f.indexedDB.onNextGetForStore('catalogs', observeRoot); f.indexedDB.onNextGetForStore('photoSmartCollections', observeDefinition);
		const source = await capturePhotoSmartCollectionArchiveV1(f.database, 'catalog');
		assert.equal(pages.reduce((sum, count) => sum + count, 0), recipes); assert.ok(Math.max(...pages) < 10);
		const base = 2 * 2_097_152 + 603_424 + 524_288 + 512;
		assert.ok(pages.every(count => base + count * Math.max(...pairBytes) <= 8_388_608));
		for await (const _recipe of source.definitions) { /* Scalar state only between yields. */ }
		pages.length = 0; await source.verify();
		assert.equal(pages.reduce((sum, count) => sum + count, 0), recipes);
		assert.ok(pages.every(count => base + 528_384 + count * Math.max(...pairBytes) <= 8_388_608));
		assert.ok(f.indexedDB.stats.keyCursorRequests.every((page: Readonly<{ delivered: number }>) => page.delivered <= 64));
	} finally { f.close(); }
});
