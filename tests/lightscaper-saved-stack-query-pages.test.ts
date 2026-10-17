/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogTransaction } from '../src/lightscaper/catalog/catalog-transaction.ts';
import { readPhotoSmartCollectionStackQueryPageV1, readPhotoSmartCollectionQueryPageV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, readPhotoSmartCollectionStorageContextV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import type { PhotoSavedQueryContinuationV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-types-v1.ts';
import { stackMetadataQueryFixtureV2, mutateStackQueryStoreV2 } from './helpers/lightscaper-photo-stack-query-v2-fixture.ts';

const all = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', sort: { field: 'file-name', direction: 'ascending' } });
const iso = normalizePhotoCatalogQueryV2({ ...all, predicate: { kind: 'number', column: 'iso', minimum: 200, maximum: 200 } });
const ids = (count = 130) => Array.from({ length: count }, (_, n) => `photo-${String(n + 1)}`);
type Fixture = Awaited<ReturnType<typeof stackMetadataQueryFixtureV2>>;
async function save(f: Fixture, query = all, id = 'saved') {
	const context = await catalogTransaction(f.database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', stores => readPhotoSmartCollectionStorageContextV1(stores, f.root.id));
	return f.repository.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: f.root.id, id, revision: 0, name: 'Saved', query }, null,
		{ expectedCatalogRevision: context.root.revision, expectedIndexRevision: context.index.indexRevision, expectedStateRevision: context.state.revision });
}
async function collect(f: Fixture) {
	let continuation: PhotoSavedQueryContinuationV1 | null = null;
	const found: string[] = [], pages = [];
	do {
		const before = f.indexedDB.stats.getRequests.length;
		const page = await f.repository.readSmartCollectionStackQueryPageV1(f.root.id, 'saved', { continuation });
		assert.ok(page.scanned <= 64 && page.items.length <= 64); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		assert.ok(f.indexedDB.stats.getRequests.slice(before).filter(row => row.store === 'photoQueryRowsV2').length <= 64);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
		if (page.continuation) assert.ok(new TextEncoder().encode(JSON.stringify(page.continuation)).byteLength <= 4096);
		found.push(...page.items.map(row => row.photoId)); pages.push(page); continuation = page.continuation;
		assert.ok(pages.length < 1100);
	} while (continuation);
	return { found, pages };
}

test('saved collapsed query globally selects effective-metadata representatives with full130-member authentication', async () => {
	const f = await stackMetadataQueryFixtureV2();
	try { await f.group(ids(), 'photo-1'); await save(f);
		const first = await f.repository.readSmartCollectionStackQueryPageV1(f.root.id, 'saved');
		assert.deepEqual(first.items, []); assert.equal(first.scanned, 64); assert.ok(first.continuation?.pending);
		const result = await collect(f); assert.deepEqual(result.found, ['photo-1']); assert.ok(result.pages.length >= 3);
		assert.equal(result.pages[0]?.mode, 'collapsed'); assert.equal(result.pages[0]?.stackStateRevision, 1);
		const seen = new Set(f.indexedDB.stats.getRequests.filter(row => row.store === 'photoStackMemberships').map(row => row.key));
		for (const id of ids()) assert.ok(seen.has(`${f.root.id}|${id}`));
	} finally { await f.close(); }
});

test('saved excluded cover uses the same complete Query2 for matching and global fallback in both directions', async () => {
	for (const direction of ['ascending', 'descending'] as const) {
		const f = await stackMetadataQueryFixtureV2();
		try { await f.group(['photo-65', 'photo-130', 'photo-1'], 'photo-130'); await save(f, normalizePhotoCatalogQueryV2({ ...iso, sort: { ...iso.sort, direction } }));
			const result = await collect(f), winner = direction === 'ascending' ? 'photo-1' : 'photo-65';
			const expected = ids(129).filter(id => !['photo-1', 'photo-65'].includes(id) || id === winner);
			assert.deepEqual(result.found, direction === 'ascending' ? expected : expected.reverse());
		} finally { await f.close(); }
	}
});

test('65-stack key audit remains bounded signed progress before any saved representatives publish', async () => {
	const f = await stackMetadataQueryFixtureV2();
	try {
		for (let n = 0; n < 65; n++) await f.group([`photo-${String(n * 2 + 1)}`, `photo-${String(n * 2 + 2)}`], `photo-${String(n * 2 + 1)}`, `stack-${String(n).padStart(3, '0')}`, n);
		await save(f, iso); const first = await f.repository.readSmartCollectionStackQueryPageV1(f.root.id, 'saved');
		assert.deepEqual(first.items, []); assert.equal(first.scanned, 64); assert.equal(first.continuation?.stackAudit?.count, 64);
		assert.deepEqual((await collect(f)).found, ids().filter((_, n) => n % 2 === 0));
	} finally { await f.close(); }
});

test('saved envelope authenticates pending member and entire saved selection before opening a transaction', async () => {
	const f = await stackMetadataQueryFixtureV2();
	try { await f.group(ids(), 'photo-1'); await save(f); await save(f, all, 'other');
		const first = await f.repository.readSmartCollectionStackQueryPageV1(f.root.id, 'saved'); assert.ok(first.continuation?.pending);
		const before = f.indexedDB.stats.getRequests.length;
		for (const patch of [{ pending: { ...first.continuation.pending, nextMember: 130 } }, { collectionStateRevision: 0 },
			{ collectionId: 'other' }, { definitionSha256: '0'.repeat(64) }, { progressSha256: '0'.repeat(64) }]) {
			await assert.rejects(readPhotoSmartCollectionStackQueryPageV1(f.database, f.root.id, patch.collectionId ?? 'saved', { continuation: { ...first.continuation, ...patch } }));
		}
		await assert.rejects(readPhotoSmartCollectionStackQueryPageV1(new Proxy(f.database, {}), f.root.id, 'saved', { continuation: first.continuation }), /signature|authentication/iu);
		await assert.rejects(readPhotoSmartCollectionQueryPageV1(f.database, f.root.id, 'saved', { continuation: first.continuation }), /mode/iu);
		assert.equal(f.indexedDB.stats.getRequests.length, before);
	} finally { await f.close(); }
});

test('saved pending member loss and grouping edits cannot produce a partially authenticated representative', async () => {
	for (const corruption of ['row', 'reverse', 'stack'] as const) {
		const f = await stackMetadataQueryFixtureV2();
		try { await f.group(ids(), 'photo-1'); await save(f);
			const first = await f.repository.readSmartCollectionStackQueryPageV1(f.root.id, 'saved'); assert.ok(first.continuation?.pending);
			if (corruption === 'stack') {
				const stack = await f.repository.loadStack(f.root.id, 'stack'), root = await f.repository.loadCatalog(f.root.id); assert.ok(stack && root);
				await f.repository.saveStack({ ...stack, coverPhotoId: 'photo-2' }, stack.revision, { expectedCatalogRevision: root.revision, expectedStateRevision: 1 });
			} else await mutateStackQueryStoreV2(f.database, corruption === 'row' ? 'photoQueryRowsV2' : 'photoStackMemberships', store => { store.delete(`${f.root.id}|photo-100`); });
			await assert.rejects(f.repository.readSmartCollectionStackQueryPageV1(f.root.id, 'saved', { continuation: first.continuation }), /missing|membership|revision|changed/iu);
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await f.close(); }
	}
});

test('saved collapsed metadata scans never bypass build readiness or query-row projection checks', async () => {
	for (const corruption of ['not-ready', 'count', 'row'] as const) {
		const f = await stackMetadataQueryFixtureV2(2);
		try { await save(f);
			if (corruption === 'row') {
				const row = f.indexedDB.records(f.databaseName, 'photoQueryRowsV2')[0] as Record<string, unknown>;
				await mutateStackQueryStoreV2(f.database, 'photoQueryRowsV2', store => { store.put({ ...row, fileNameSort: 'forged' }); });
			} else await mutateStackQueryStoreV2(f.database, 'photoQueryBuildStatesV2', store => {
				store.put({ id: f.root.id, schemaVersion: 2, ready: corruption !== 'not-ready', afterKey: null, indexedCount: corruption === 'count' ? 1 : 2 });
			});
			await assert.rejects(f.repository.readSmartCollectionStackQueryPageV1(f.root.id, 'saved'));
		} finally { await f.close(); }
	}
});
