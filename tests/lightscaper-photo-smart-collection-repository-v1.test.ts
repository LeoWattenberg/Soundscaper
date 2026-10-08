/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import { photoSmartCollectionKeyV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { indexState } from '../src/lightscaper/catalog/repository-records.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { SMART_COLLECTION_TEST_DATABASE as DB, smartCollectionDefinitionV1 as definition,
	smartCollectionRepositoryFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-repository-fixture.ts';

test('create/update/delete publish paired saved-query documents and small authoritative revision receipts', async () => {
	const f = await fixture();
	try {
		const created = await f.repository.saveSmartCollection(definition(), null, await f.writeOptions());
		assert.equal(created.definition?.revision, 0); assert.equal(created.catalogRevision, 1); assert.equal(created.indexRevision, 1);
		assert.deepEqual(created.state, { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 1, collectionCount: 1 });
		assert.equal(Object.hasOwn(created, 'root'), false); assert.ok(Object.isFrozen(created));
		assert.deepEqual(await f.repository.loadSmartCollection('catalog', 'saved'), normalizePhotoSmartCollectionV1(definition()));
		const candidate = { ...definition(), name: 'Authored name', query: { ...definition().query, text: 'Canon lens' } };
		const edited = await f.repository.saveSmartCollection(candidate, 0, await f.writeOptions());
		assert.equal(edited.definition?.revision, 1); assert.equal(edited.state.revision, 2); assert.equal(edited.state.collectionCount, 1);
		assert.equal(edited.definition?.query.text, 'canon lens');
		const deleted = await f.repository.deleteSmartCollection('catalog', 'saved', 1, await f.writeOptions());
		assert.equal(deleted.definition, null); assert.equal(deleted.state.collectionCount, 0); assert.equal(deleted.state.revision, 3);
		assert.equal(await f.repository.loadSmartCollection('catalog', 'saved'), null);
		assert.deepEqual(await f.repository.readSmartCollectionState('catalog'), deleted.state);
	} finally { await f.repository.close(); f.database.close(); }
});

test('two durable owners conflict on captured catalog/index/state/definition fences and preserve last-delete ABA revision', async () => {
	const f = await fixture(), other = f.create();
	try {
		const initial = await f.writeOptions();
		await f.repository.saveSmartCollection(definition(), null, initial);
		await assert.rejects(other.saveSmartCollection(definition('second'), null, initial), /changed|revision/iu);
		const options = await f.writeOptions();
		for (const field of ['expectedCatalogRevision', 'expectedIndexRevision', 'expectedStateRevision'] as const) {
			await assert.rejects(other.saveSmartCollection(definition('second'), null, { ...options, [field]: 0 }), /changed|revision/iu);
		}
		await assert.rejects(other.saveSmartCollection({ ...definition(), revision: 1 }, 1, options), /changed|revision/iu);
		await f.repository.deleteSmartCollection('catalog', 'saved', 0, options);
		const empty = await f.writeOptions();
		await assert.rejects(other.saveSmartCollection(definition(), null, { ...empty, expectedStateRevision: 0 }), /changed|revision/iu);
		assert.equal((await other.saveSmartCollection(definition(), null, empty)).state.revision, 3);
	} finally { await other.close(); await f.repository.close(); f.database.close(); }
});

test('saved-query edits never touch photos, originals, memberships or either query profile', async () => {
	const f = await fixture();
	try {
		await f.repository.publishPhotos('catalog', 0, [queryPhotoV1()]);
		const untouched = ['photos', 'summaries', 'memberships', 'photoQueryRows', 'photoQueryRowsV2', 'photoQueryBuildStates', 'photoQueryBuildStatesV2'];
		const before = untouched.map(store => f.indexedDB.records(DB, store));
		await f.repository.saveSmartCollection(definition(), null, await f.writeOptions());
		await f.repository.deleteSmartCollection('catalog', 'saved', 0, await f.writeOptions());
		assert.deepEqual(untouched.map(store => f.indexedDB.records(DB, store)), before);
	} finally { await f.repository.close(); f.database.close(); }
});

test('complete negated references and root-only collection namespace are checked before publication', async () => {
	const f = await fixture();
	try {
		for (const id of ['manual', 'smart']) await assert.rejects(f.repository.saveSmartCollection(definition(id), null, await f.writeOptions()), /ID|identity|exists/iu);
		await f.repository.saveSmartCollection(definition(), null, await f.writeOptions());
		for (const [kind, id] of [['folder', 'missing'], ['keyword', 'missing']] as const) {
			const candidate = { ...definition('other'), query: { ...definition().query, predicate: { kind: 'any', terms: [
				{ kind: 'rating', minimum: 0, maximum: 5 }, { kind: 'not', term: { kind, id } },
			] } } };
			await assert.rejects(f.repository.saveSmartCollection(candidate, null, await f.writeOptions()), /reference|missing/iu);
		}
		await assert.rejects(f.repository.saveSmartCollection({ ...definition('other'), query: { ...definition().query,
			filter: { kind: 'collection', id: 'saved' } } }, null, await f.writeOptions()), /reference|missing/iu);
	} finally { await f.repository.close(); f.database.close(); }
});

test('combined10000 limit permits the final saved definition and rejects an additional one without state changes', async () => {
	const root = { ...queryCatalogRootV1(), collections: Array.from({ length: 9_999 }, (_, index) => ({ id: `old-${index}`, name: 'Old', kind: 'manual' as const })) };
	const f = await fixture(root);
	try {
		await f.repository.saveSmartCollection(definition(), null, await f.writeOptions());
		const before = await f.context();
		await assert.rejects(f.repository.saveSmartCollection(definition('other'), null, await f.writeOptions()), /combined|budget|10000/iu);
		assert.deepEqual(await f.context(), before);
	} finally { await f.repository.close(); f.database.close(); }
});

test('explicit load returns null only when both sides are absent and refuses orphan or mismatched summary authority', async () => {
	for (const corruption of ['definition', 'summary', 'name', 'revision'] as const) {
		const f = await fixture(); f.seed(2);
		const key = photoSmartCollectionKeyV1('catalog', 'saved-0001');
		if (corruption === 'definition' || corruption === 'summary') await f.mutate(corruption === 'definition' ? 'photoSmartCollections' : 'photoSmartCollectionSummaries', async store => { await f.request(store.delete(key)); });
		else {
			const rows: unknown[] = f.indexedDB.records(DB, 'photoSmartCollectionSummaries');
			const row = rows[1] as { key: string; catalogId: string; document: { revision: number; name: string } };
			f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', { ...row, document: { ...row.document,
				...(corruption === 'name' ? { name: 'Tampered' } : { revision: 1 }) } });
		}
		try { await assert.rejects(f.repository.loadSmartCollection('catalog', 'saved-0001'), /missing|orphan|summary|disagree/iu); }
		finally { await f.repository.close(); f.database.close(); }
	}
});

test('summary pages seek directly, retain at most64 small summaries, and never read full definition bodies', async () => {
	const f = await fixture(); f.seed(129);
	try {
		const seen: string[] = [];
		let continuation = null;
		do {
			const before = f.indexedDB.stats.getRequests.length;
			const page = await f.repository.readSmartCollectionPage('catalog', { continuation });
			assert.ok(page.items.length <= 64); assert.ok(new TextEncoder().encode(JSON.stringify(page.items)).byteLength <= 262_144);
			const reads: readonly { store: string }[] = f.indexedDB.stats.getRequests.slice(before);
			assert.equal(reads.some(read => read.store === 'photoSmartCollections'), false);
			seen.push(...page.items.map(item => item.id)); continuation = page.continuation;
		} while (continuation);
		assert.deepEqual(seen, Array.from({ length: 129 }, (_, index) => `saved-${String(index).padStart(4, '0')}`));
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
	} finally { await f.repository.close(); f.database.close(); }
});

test('page cursor cannot cross catalog/scope/key/revision or become a publication audit proof', async () => {
	const f = await fixture(); f.seed(65);
	try {
		const page = await f.repository.readSmartCollectionPage('catalog'); assert.ok(page.continuation);
		for (const alteration of [{ catalogId: 'foreign' }, { scope: 'photos' }, { afterKey: '["foreign","saved"]' },
			{ stateRevision: 0 }, { indexRevision: 4 }, { catalogRevision: 9 }, { schemaVersion: 2 }, { proof: {} }]) {
			await assert.rejects(f.repository.readSmartCollectionPage('catalog', { continuation: { ...page.continuation, ...alteration } }));
		}
		await f.repository.saveSmartCollection(definition('new'), null, await f.writeOptions());
		await assert.rejects(f.repository.readSmartCollectionPage('catalog', { continuation: page.continuation }), /changed|revision/iu);
	} finally { await f.repository.close(); f.database.close(); }
});

test('all scalar revision exhaustion refuses before any definition/root/index/state publication', async () => {
	for (const exhausted of ['catalog', 'index', 'state', 'definition'] as const) {
		const f = await fixture();
		try {
			await f.repository.saveSmartCollection(definition(), null, await f.writeOptions());
			const current = await f.context();
			if (exhausted === 'catalog') {
				const root = { ...current.root, revision: Number.MAX_SAFE_INTEGER };
				f.indexedDB.seedRecord(DB, 'catalogs', root); f.indexedDB.seedRecord(DB, 'catalogStates', indexState(root, current.index.indexRevision));
			} else if (exhausted === 'index') f.indexedDB.seedRecord(DB, 'catalogStates', { ...current.index, indexRevision: Number.MAX_SAFE_INTEGER });
			else if (exhausted === 'state') f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', { ...current.state, revision: Number.MAX_SAFE_INTEGER });
			else {
				const document = { ...definition(), revision: Number.MAX_SAFE_INTEGER };
				const { photoSmartCollectionRecordV1 } = await import('../src/lightscaper/catalog/photo-smart-collection-record-v1.ts');
				const { photoSmartCollectionSummaryRecordV1 } = await import('../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts');
				f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1(document));
				f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(document));
			}
			const before = ['catalogs', 'catalogStates', 'photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates'].map(store => f.indexedDB.records(DB, store));
			const revision = exhausted === 'definition' ? Number.MAX_SAFE_INTEGER : 0;
			await assert.rejects(f.repository.saveSmartCollection({ ...definition(), revision }, revision, await f.writeOptions()), /safe|revision|between|exhaust/iu);
			assert.deepEqual(['catalogs', 'catalogStates', 'photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates'].map(store => f.indexedDB.records(DB, store)), before);
		} finally { await f.repository.close(); f.database.close(); }
	}
});
