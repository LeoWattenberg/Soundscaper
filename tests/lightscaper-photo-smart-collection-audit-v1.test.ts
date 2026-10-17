/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { auditPhotoSmartCollectionStorageV1, assertPhotoSmartCollectionStorageAuditV1, PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1 } from '../src/lightscaper/catalog/photo-smart-collection-audit-v1.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { indexState } from '../src/lightscaper/catalog/repository-records.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { AUDIT_DATABASE, auditDefinitionV1, auditMaximumRootV1, auditRootV1, auditStateV1, smartCollectionAuditFixtureV1 } from './helpers/lightscaper-smart-collection-audit-fixture.ts';

test('private proof binds database, exact chosen root, captured context and one final consumption', async () => {
	const f = await smartCollectionAuditFixtureV1(2), other = await smartCollectionAuditFixtureV1(2);
	try {
		const candidate = { ...f.root, name: 'Candidate' };
		const proof = await auditPhotoSmartCollectionStorageV1(f.database, candidate, { expectedCatalogRevision: 0 });
		const context = await f.context();
		assert.ok(Object.isFrozen(proof)); assert.deepEqual(Object.keys(proof), []);
		for (const forged of [{}, Object.create(proof) as unknown, null]) assert.throws(() => assertPhotoSmartCollectionStorageAuditV1(forged, f.database, context, candidate));
		assert.throws(() => assertPhotoSmartCollectionStorageAuditV1(proof, other.database, context, candidate));
		assert.throws(() => assertPhotoSmartCollectionStorageAuditV1(proof, f.database, context, f.root));
		assertPhotoSmartCollectionStorageAuditV1(proof, f.database, context, candidate);
		assert.throws(() => assertPhotoSmartCollectionStorageAuditV1(proof, f.database, context, candidate));
	} finally { f.close(); other.close(); }
});

test('one100-row audit uses only bounded key cursors and leaves no native transaction open', async () => {
	const f = await smartCollectionAuditFixtureV1(100);
	try {
		await auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0 });
		assert.equal(f.indexedDB.stats.cursorRequests.length, 0);
		assert.equal(f.indexedDB.stats.countRequests.length, 0); assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
		const keys = f.indexedDB.stats.keyCursorRequests as unknown as readonly { delivered: number }[];
		assert.ok(keys.length > 4); assert.ok(keys.every(page => page.delivered <= 64));
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
		assert.equal(PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.maximumPageBytes, 8_388_608);
	} finally { f.close(); }
});

test('native index seeking is required rather than falling back to an unbounded prefix scan', async () => {
	const f = await smartCollectionAuditFixtureV1(70, undefined, false);
	try { await assert.rejects(auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0 }), /continuePrimaryKey|seeking/iu); }
	finally { f.close(); }
});

test('primary-scope and indexed-scope audits catch hidden and foreign later rows', async () => {
	for (const corruption of ['hidden-definition', 'foreign-definition', 'hidden-summary', 'foreign-summary'] as const) {
		const f = await smartCollectionAuditFixtureV1(2), value = auditDefinitionV1(2);
		const summary = corruption.endsWith('summary'), store = summary ? 'photoSmartCollectionSummaries' : 'photoSmartCollections';
		const row = summary ? photoSmartCollectionSummaryRecordV1(value) : photoSmartCollectionRecordV1(value);
		f.indexedDB.seedRecord(AUDIT_DATABASE, store, corruption.startsWith('hidden')
			? { ...row, catalogId: 'foreign' } : { ...row, key: '["z-foreign","saved"]' });
		try { await assert.rejects(auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0 })); }
		finally { f.close(); }
	}
});

test('absent and retained empty states refuse hidden physical orphans without trusting negative indexes', async () => {
	for (const retained of [false, true]) {
		const f = await smartCollectionAuditFixtureV1();
		if (retained) f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', auditStateV1(0));
		f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollections', { ...photoSmartCollectionRecordV1(auditDefinitionV1()), catalogId: 'foreign' });
		f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionSummaries', { ...photoSmartCollectionSummaryRecordV1(auditDefinitionV1()), catalogId: 'foreign' });
		try { await assert.rejects(auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0 }), /count|scope|identity/iu); }
		finally { f.close(); }
	}
});

test('root/index/state drift during later pages refuses instead of returning authority', async () => {
	for (const drift of ['root', 'index', 'state'] as const) {
		const f = await smartCollectionAuditFixtureV1(30);
		let reads = 0;
		function observe() {
			if (++reads === 2) {
				if (drift === 'root') f.indexedDB.seedRecord(AUDIT_DATABASE, 'catalogs', { ...f.root, name: 'Unversioned corruption' });
				if (drift === 'index') f.indexedDB.seedRecord(AUDIT_DATABASE, 'catalogStates', indexState(f.root, 9));
				if (drift === 'state') f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', auditStateV1(30, 8));
			} else f.indexedDB.onNextGetForStore('catalogs', observe);
		}
		f.indexedDB.onNextGetForStore('catalogs', observe);
		try { await assert.rejects(auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0 }), /revision|changed|conflict/iu); }
		finally { f.close(); }
	}
});

test('closed requests and native abort reasons refuse before resource access without evaluating overrides', async () => {
	const f = await smartCollectionAuditFixtureV1();
	try {
		const stop = new AbortController(), reason = new Proxy({}, { get() { throw new Error('opaque inspection'); } });
		stop.abort(reason); Object.defineProperty(stop.signal, 'throwIfAborted', { get() { throw new Error('signal inspection'); } });
		let failure: unknown;
		try { await auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0, signal: stop.signal }); } catch (error) { failure = error; }
		assert.equal(failure, reason);
		await assert.rejects(auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0, extra: true }), /unexpected|unknown|field/iu);
		assert.equal(f.indexedDB.stats.getRequests.length, 0);
	} finally { f.close(); }
});

test('late opaque cancellation joins the active native definition transaction', async () => {
	const f = await smartCollectionAuditFixtureV1(3), stop = new AbortController();
	let inspections = 0, failure: unknown;
	const reason = new Proxy({}, { getPrototypeOf() { inspections++; throw new Error('opaque prototype'); }, get() { inspections++; throw new Error('opaque property'); } });
	f.indexedDB.onNextGetForStore('photoSmartCollections', () => { assert.equal(f.indexedDB.stats.activeTransactions, 1); stop.abort(reason); });
	try {
		try { await auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0, signal: stop.signal }); } catch (error) { failure = error; }
		assert.equal(failure, reason); assert.equal(inspections, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.close(); }
});

test('near2MiB roots and escaped full predicates reduce native page admission below ten definitions', async () => {
	const initial = auditRootV1();
	const root = normalizePhotoCatalogRootV1({ ...initial, keywords: [...initial.keywords,
		...Array.from({ length: 6_900 }, (_, index) => ({ id: `z-${String(index)}`, name: '界'.repeat(80), parentId: null }))] });
	const f = await smartCollectionAuditFixtureV1(0, root);
	const pages: number[] = [], sizes: number[] = [];
	function observeRoot() { pages.push(0); f.indexedDB.onNextGetForStore('catalogs', observeRoot); }
	function observeDefinition() { pages[pages.length - 1]!++; f.indexedDB.onNextGetForStore('photoSmartCollections', observeDefinition); }
	for (let index = 0; index < 14; index++) {
		const value = { ...auditDefinitionV1(index), query: { schemaVersion: 2, kind: 'photo-catalog-query',
			predicate: { kind: 'all', terms: Array.from({ length: 255 }, () => ({ kind: 'text', column: 'title', operator: 'equals', value: '\ud800'.repeat(256) })) } } };
		f.seed(value);
		sizes.push(new TextEncoder().encode(JSON.stringify(photoSmartCollectionRecordV1(value))).byteLength
			+ new TextEncoder().encode(JSON.stringify(photoSmartCollectionSummaryRecordV1(value))).byteLength);
	}
	f.indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', auditStateV1(14));
	f.indexedDB.onNextGetForStore('catalogs', observeRoot); f.indexedDB.onNextGetForStore('photoSmartCollections', observeDefinition);
	try {
		await auditPhotoSmartCollectionStorageV1(f.database, root, { expectedCatalogRevision: 0 });
		const rootBytes = new TextEncoder().encode(JSON.stringify(root)).byteLength;
		assert.ok(rootBytes > 1_900_000); assert.ok(sizes.every(bytes => bytes > 400_000));
		const context = await f.context(), overhead = new TextEncoder().encode(JSON.stringify(context.index)).byteLength
			+ new TextEncoder().encode(JSON.stringify(context.state)).byteLength;
		const base = rootBytes * 2 + overhead + PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes
			+ PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.reservedScalarBytes;
		assert.equal(pages.reduce((sum, count) => sum + count, 0), 14);
		assert.equal(Math.max(...pages), 7);
		assert.ok(pages.every(count => base + count * Math.max(...sizes) <= PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.maximumPageBytes));
		pages.length = 0;
		await auditPhotoSmartCollectionStorageV1(f.database, root, { expectedCatalogRevision: 0,
			retainedBytes: PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes });
		assert.equal(pages.reduce((sum, count) => sum + count, 0), 14);
		assert.equal(Math.max(...pages), 6);
		assert.ok(pages.every(count => base + PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + count * Math.max(...sizes)
			<= PHOTO_SMART_COLLECTION_AUDIT_LIMITS_V1.maximumPageBytes));
		assert.equal(f.indexedDB.stats.cursorRequests.length, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.close(); }
});

test('retained caller bytes require a closed bounded inert scalar before any native resource read', async () => {
	const f = await smartCollectionAuditFixtureV1();
	let getterCalls = 0;
	try {
		for (const retainedBytes of [-1, PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes + 1, Number.NaN, Number.POSITIVE_INFINITY,
			0.5, '0', null, undefined]) {
			await assert.rejects(auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0, retainedBytes }), /byte|integer|between/iu);
		}
		const hostile = { expectedCatalogRevision: 0, get retainedBytes() { getterCalls++; throw new Error('Retained getter evaluated'); } };
		await assert.rejects(auditPhotoSmartCollectionStorageV1(f.database, f.root, hostile), /inert|accessor|data/iu);
		assert.equal(getterCalls, 0); assert.equal(f.indexedDB.stats.getRequests.length, 0);
		const proxy = new Proxy({ expectedCatalogRevision: 0, retainedBytes: 0 }, { get() { getterCalls++; throw new Error('Retained proxy get evaluated'); } });
		const proof = await auditPhotoSmartCollectionStorageV1(f.database, f.root, proxy);
		assert.equal(getterCalls, 0); assert.ok(Object.isFrozen(proof));
	} finally { f.close(); }
});

test('final proof rejects same-revision context corruption without consuming valid authority', async () => {
	const f = await smartCollectionAuditFixtureV1(1);
	try {
		const proof = await auditPhotoSmartCollectionStorageV1(f.database, f.root, { expectedCatalogRevision: 0 }), context = await f.context();
		for (const altered of [{ ...context, root: { ...context.root, name: 'Changed' } },
			{ ...context, index: { ...context.index, indexRevision: 9 } }, { ...context, state: { ...context.state, revision: 8 } }]) {
			assert.throws(() => assertPhotoSmartCollectionStorageAuditV1(proof, f.database, altered, f.root), /revision|conflict/iu);
		}
		assertPhotoSmartCollectionStorageAuditV1(proof, f.database, context, f.root);
	} finally { f.close(); }
});

test('an unbranded frozen root above2MiB refuses before native reads, while the exact limit audits successfully', async () => {
	const root = auditMaximumRootV1(), f = await smartCollectionAuditFixtureV1(1, root);
	const oversized = normalizePhotoCatalogRootV1({ ...root, name: `${root.name}x` });
	try {
		assert.equal(new TextEncoder().encode(JSON.stringify(root)).byteLength, 2_097_152);
		assert.ok(Object.isFrozen(oversized)); assert.ok(Object.isFrozen(oversized.keywords));
		await assert.rejects(auditPhotoSmartCollectionStorageV1(f.database, oversized, { expectedCatalogRevision: 0 }), /byte budget/iu);
		assert.equal(f.indexedDB.stats.getRequests.length, 0);
		const proof = await auditPhotoSmartCollectionStorageV1(f.database, root, { expectedCatalogRevision: 0 });
		assertPhotoSmartCollectionStorageAuditV1(proof, f.database, await f.context(), root);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.close(); }
});
