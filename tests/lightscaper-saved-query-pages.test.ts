/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoSmartCollectionQueryPageV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { photoSmartCollectionRecordV1, photoSmartCollectionKeyV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { SMART_COLLECTION_TEST_DATABASE as DB, smartCollectionRepositoryFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-repository-fixture.ts';

const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query' });
async function prepare(count = 130, criteria: unknown = query) {
	const f = await fixture();
	let revision = 0;
	for (let offset = 0; offset < count; offset += 16) revision = (await f.repository.publishPhotos('catalog', revision,
		Array.from({ length: Math.min(16, count - offset) }, (_, delta) => queryPhotoV1(offset + delta)))).revision;
	await f.repository.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog',
		id: 'saved', revision: 0, name: 'Saved criteria', query: criteria }, null, await f.writeOptions());
	return f;
}
type Fixture = Awaited<ReturnType<typeof prepare>>;
async function collect(f: Fixture) {
	let continuation: Awaited<ReturnType<typeof readPhotoSmartCollectionQueryPageV1>>['continuation'] = null;
	const found: string[] = [], pages = [];
	do {
		const page = await readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved', { continuation });
		assert.ok(page.scanned <= 64 && page.items.length <= 64); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		found.push(...page.items.map(row => row.photoId)); pages.push(page); continuation = page.continuation;
		assert.ok(pages.length <= 20);
	} while (continuation);
	return { found, pages };
}
async function close(f: Fixture) { f.database.close(); await f.repository.close(); }

test('saved full Query2 preserves live keyword text, manual filter and effective predicates through bounded scalar pages', async () => {
	const criteria = normalizePhotoCatalogQueryV2({ ...query, text: 'LANDSCAPE', filter: { kind: 'collection', id: 'manual' },
		predicate: { kind: 'all', terms: [{ kind: 'rating', minimum: 2, maximum: 5 }, { kind: 'presence', column: 'camera-make', value: 'unknown' }] } });
	const f = await prepare(130, criteria);
	try {
		const saved = await collect(f); assert.deepEqual(saved.found, Array.from({ length: 130 }, (_, n) => n)
			.filter(n => n % 2 === 0 && n % 6 >= 2).map(n => queryPhotoV1(n).id));
		for (const page of saved.pages) { assert.equal(page.mode, 'ordinary'); assert.equal(page.collectionId, 'saved');
			assert.equal(page.definitionRevision, 0); assert.equal(page.collectionStateRevision, 1); assert.equal(Object.hasOwn(page, 'query'), false); }
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
		const root = await f.repository.loadCatalog('catalog'); assert.ok(root);
		await f.repository.saveCatalog({ ...root, keywords: root.keywords.map(node => ({ ...node, name: 'Renamed keyword' })) }, root.revision);
		assert.deepEqual((await collect(f)).found, []);
		assert.equal((await f.repository.loadSmartCollection('catalog', 'saved'))?.query.text, 'landscape');
	} finally { await close(f); }
});

test('saved sparse scans retain empty continuation pages and capture ordering keeps unknown clocks last both ways', async () => {
	for (const direction of ['ascending', 'descending'] as const) {
		const criteria = normalizePhotoCatalogQueryV2({ ...query, sort: { field: 'capture-time', direction } });
		const f = await prepare(130, criteria);
		try { const result = await collect(f), known = result.found.filter(id => queryPhotoV1(Number(id.slice(-6))).metadata.captureTime !== null);
			assert.deepEqual(result.found.slice(known.length), result.found.filter(id => !known.includes(id)));
			const clocks = known.map(id => queryPhotoV1(Number(id.slice(-6))).metadata.captureTime!.local);
			assert.deepEqual(clocks, [...clocks].sort().sort((a, b) => direction === 'ascending' ? a.localeCompare(b) : b.localeCompare(a)));
		} finally { await close(f); }
	}
	const f = await prepare(130, { ...query, predicate: { kind: 'file-name', contains: '99871' } });
	try { const result = await collect(f); assert.deepEqual(result.pages.slice(0, 2).map(page => page.items), [[], []]);
		assert.deepEqual(result.found, [queryPhotoV1(129).id]); } finally { await close(f); }
});

test('edit and delete/recreate saved identity retire continuation even when the recreated definition revision is zero', async () => {
	for (const mutation of ['edit', 'recreate'] as const) {
		const f = await prepare();
		try { const first = await readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved'); assert.ok(first.continuation);
			if (mutation === 'recreate') await f.repository.deleteSmartCollection('catalog', 'saved', 0, await f.writeOptions());
			await f.repository.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog', id: 'saved',
				revision: 0, name: 'Changed', query }, mutation === 'edit' ? 0 : null, await f.writeOptions());
			await assert.rejects(readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved', { continuation: first.continuation }), /revision|changed/iu);
		} finally { await close(f); }
	}
});

test('same revision changed query and paired summary corruption are refused before another row scan', async () => {
	for (const corruption of ['query', 'summary'] as const) {
		const f = await prepare();
		try { const first = await readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved'); assert.ok(first.continuation);
			const current = await f.repository.loadSmartCollection('catalog', 'saved'); assert.ok(current);
			if (corruption === 'query') f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1({ ...current, query: { ...query, text: 'changed' } }));
			else f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1({ ...current, name: 'forged' }));
			const before = f.indexedDB.stats.cursorRequests.length, gets = f.indexedDB.stats.getRequests.length;
			await assert.rejects(readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved', { continuation: first.continuation }), /digest|definition|summary|query/iu);
			assert.equal(f.indexedDB.stats.cursorRequests.length, before);
			assert.equal(f.indexedDB.stats.getRequests.slice(gets).some((row: Readonly<{ store: string }>) => row.store === 'photoQueryRowsV2'), false);
		} finally { await close(f); }
	}
});

test('whole saved envelope refuses relabeling, foreign connection and unknown input without caller accessors', async () => {
	const f = await prepare();
	try { const first = await readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved'); assert.ok(first.continuation);
		const reads = f.indexedDB.stats.getRequests.length, cursors = f.indexedDB.stats.cursorRequests.length;
		const transaction = f.database.transaction.bind(f.database); let transactions = 0;
		f.database.transaction = ((names: string | string[], mode?: IDBTransactionMode) => { transactions++; return transaction(names, mode); }) as IDBDatabase['transaction'];
		let getters = 0;
		await assert.rejects(readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved', Object.defineProperty({}, 'continuation', { enumerable: true, get() { getters++; return first.continuation; } })));
		assert.equal(getters, 0);
		for (const patch of [{ collectionId: 'other' }, { definitionRevision: 1 }, { progressSha256: '0'.repeat(64) }])
			await assert.rejects(readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved', { continuation: { ...first.continuation, ...patch } }));
		await assert.rejects(readPhotoSmartCollectionQueryPageV1(new Proxy(f.database, {}), 'catalog', 'saved', { continuation: first.continuation }), /signature|authentication/iu);
		await assert.rejects(readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved', Object.assign({}, { continuation: null, query })));
		assert.equal(f.indexedDB.stats.getRequests.length, reads); assert.equal(f.indexedDB.stats.cursorRequests.length, cursors); assert.equal(transactions, 0);
	} finally { await close(f); }
});

test('target summary/definition orphans and every hidden missing hierarchy reference reject before scanning', async () => {
	for (const corruption of ['orphan', 'reference'] as const) {
		const f = await prepare(2);
		try { const current = await f.repository.loadSmartCollection('catalog', 'saved'); assert.ok(current);
			if (corruption === 'orphan') await f.mutate('photoSmartCollectionSummaries', async store => { await f.request(store.delete(photoSmartCollectionKeyV1('catalog', 'saved'))); });
			else f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1({ ...current, query: { ...query, predicate: {
				kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 }, { kind: 'not', term: { kind: 'keyword', id: 'missing' } }] } } }));
			const before = f.indexedDB.stats.cursorRequests.length, gets = f.indexedDB.stats.getRequests.length;
			await assert.rejects(readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved'));
			assert.equal(f.indexedDB.stats.cursorRequests.length, before);
			assert.equal(f.indexedDB.stats.getRequests.slice(gets).some((row: Readonly<{ store: string }>) => row.store === 'photoQueryRowsV2'), false);
		} finally { await close(f); }
	}
});
