/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { readPhotoSmartCollectionSnapshotV1 } from '../src/lightscaper/catalog/photo-smart-collection-snapshot-v1.ts';
import { photoSmartCollectionKeyV1, photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { SMART_COLLECTION_TEST_DATABASE as DB, smartCollectionDefinitionV1 as definition,
	smartCollectionRepositoryFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-repository-fixture.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
type RecordedGet = Readonly<{ store: string }>;
const contents = (f: Fixture) => PHOTO_CATALOG_STORES.map(store => f.indexedDB.records(DB, store));
const options = (context: Readonly<{ catalogRevision: number; indexRevision: number; collectionStateRevision: number }>) => ({
	expectedCatalogRevision: context.catalogRevision, expectedIndexRevision: context.indexRevision,
	expectedStateRevision: context.collectionStateRevision,
});
async function close(f: Fixture) { f.database.close(); await f.repository.close(); }

test('cold creation snapshot exposes only atomic scalar context and makes no durable or full-definition reads', async () => {
	const f = await fixture();
	try {
		const before = contents(f), gets = f.indexedDB.stats.getRequests.length;
		const snapshot = await f.repository.readSmartCollectionSnapshotV1('catalog', null);
		assert.deepEqual(snapshot, { schemaVersion: 1, kind: 'photo-smart-collection-snapshot', selectedId: null,
			context: { catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, collectionStateRevision: 0, collectionCount: 0 }, definition: null });
		assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.context));
		assert.deepEqual(f.indexedDB.stats.getRequests.slice(gets).map((row: RecordedGet) => row.store), ['catalogs', 'catalogStates', 'photoSmartCollectionStates']);
		assert.deepEqual(contents(f), before); assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await close(f); }
});

test('a selected snapshot reads one definition and paired summary in the same five-store readonly transaction as its revisions', async () => {
	const f = await fixture(); f.seed(65);
	const native = f.database.transaction.bind(f.database), transactions: { stores: string[]; mode: IDBTransactionMode }[] = [];
	f.database.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		transactions.push({ stores: typeof names === 'string' ? [names] : [...names], mode: mode ?? 'readonly' }); return native(names, mode);
	}) as IDBDatabase['transaction'];
	try {
		const before = contents(f), gets = f.indexedDB.stats.getRequests.length, cursors = f.indexedDB.stats.cursorRequests.length;
		const snapshot = await readPhotoSmartCollectionSnapshotV1(f.database, 'catalog', 'saved-0064');
		assert.deepEqual(snapshot.context, { catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, collectionStateRevision: 1, collectionCount: 65 });
		assert.equal(snapshot.selectedId, 'saved-0064'); assert.equal(snapshot.definition?.query.text, 'landscape');
		assert.deepEqual(snapshot.definition?.query.predicate, definition().query.predicate);
		assert.ok(Object.isFrozen(snapshot.definition)); assert.ok(Object.isFrozen(snapshot.definition?.query));
		assert.deepEqual(transactions, [{ stores: ['catalogs', 'catalogStates', 'photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates'], mode: 'readonly' }]);
		assert.equal(f.indexedDB.stats.getRequests.slice(gets).filter((row: RecordedGet) => row.store === 'photoSmartCollections').length, 1);
		assert.equal(f.indexedDB.stats.getRequests.slice(gets).filter((row: RecordedGet) => row.store === 'photoSmartCollectionSummaries').length, 1);
		assert.equal(f.indexedDB.stats.cursorRequests.length, cursors); assert.deepEqual(contents(f), before);
		assert.equal(Object.hasOwn(snapshot, 'root'), false); assert.equal(Object.hasOwn(snapshot, 'referenceKeys'), false);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { f.database.transaction = native; await close(f); }
});

test('creation and selected snapshot context authorize the matching revision and stale snapshots cannot publish', async () => {
	const f = await fixture();
	try {
		const creation = await f.repository.readSmartCollectionSnapshotV1('catalog', null);
		await f.repository.saveSmartCollection(definition(), null, options(creation.context));
		const loaded = await f.repository.readSmartCollectionSnapshotV1('catalog', 'saved'); assert.ok(loaded.definition);
		assert.deepEqual(loaded.context, { catalogId: 'catalog', catalogRevision: 1, indexRevision: 1, collectionStateRevision: 1, collectionCount: 1 });
		let before = contents(f);
		await assert.rejects(f.repository.saveSmartCollection(definition('another'), null, options(creation.context)), /revision|changed/iu);
		assert.deepEqual(contents(f), before);
		await f.repository.saveSmartCollection({ ...loaded.definition, name: 'Edited recipe' }, loaded.definition.revision, options(loaded.context));
		before = contents(f);
		await assert.rejects(f.repository.deleteSmartCollection('catalog', 'saved', loaded.definition.revision, options(loaded.context)), /revision|changed/iu);
		assert.deepEqual(contents(f), before);
		const edited = await f.repository.readSmartCollectionSnapshotV1('catalog', 'saved');
		assert.equal(edited.definition?.revision, 1); assert.equal(edited.definition?.name, 'Edited recipe');
		assert.deepEqual(edited.context, { catalogId: 'catalog', catalogRevision: 2, indexRevision: 2, collectionStateRevision: 2, collectionCount: 1 });
	} finally { await close(f); }
});

test('a deleted or genuinely missing selection returns absence with fresh retained tombstone context', async () => {
	const f = await fixture();
	try {
		await f.repository.saveSmartCollection(definition(), null, await f.writeOptions());
		const saved = await f.repository.readSmartCollectionSnapshotV1('catalog', 'saved');
		await f.repository.deleteSmartCollection('catalog', 'saved', 0, options(saved.context));
		for (const selected of ['saved', 'never-created']) {
			const missing = await f.repository.readSmartCollectionSnapshotV1('catalog', selected);
			assert.equal(missing.selectedId, selected); assert.equal(missing.definition, null);
			assert.deepEqual(missing.context, { catalogId: 'catalog', catalogRevision: 2, indexRevision: 2, collectionStateRevision: 2, collectionCount: 0 });
		}
	} finally { await close(f); }
});

test('snapshot refuses target orphans, paired summary disagreement, private projection corruption and hidden missing references without scanning photos', async () => {
	for (const corruption of ['orphan', 'summary', 'projection', 'reference'] as const) {
		const f = await fixture(); f.seed(2); const candidate = definition('saved-0001');
		try {
			if (corruption === 'orphan') await f.mutate('photoSmartCollectionSummaries', async store => { await f.request(store.delete(photoSmartCollectionKeyV1('catalog', candidate.id))); });
			else if (corruption === 'summary') f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1({ ...candidate, name: 'Unpaired title' }));
			else if (corruption === 'projection') f.indexedDB.seedRecord(DB, 'photoSmartCollections', { ...photoSmartCollectionRecordV1(candidate), referenceKeys: [] });
			else f.indexedDB.seedRecord(DB, 'photoSmartCollections', photoSmartCollectionRecordV1({ ...candidate, query: { ...candidate.query,
				predicate: { kind: 'any', terms: [{ kind: 'rating', minimum: 0, maximum: 5 }, { kind: 'not', term: { kind: 'keyword', id: 'missing' } }] } } }));
			const before = contents(f), gets = f.indexedDB.stats.getRequests.length, cursors = f.indexedDB.stats.cursorRequests.length;
			await assert.rejects(f.repository.readSmartCollectionSnapshotV1('catalog', candidate.id));
			assert.deepEqual(contents(f), before); assert.equal(f.indexedDB.stats.cursorRequests.length, cursors);
			assert.equal(f.indexedDB.stats.getRequests.slice(gets).some((row: RecordedGet) => ['photos', 'photoQueryRows', 'photoQueryRowsV2'].includes(row.store)), false);
			assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { await close(f); }
	}
});

test('snapshot rejects malformed selection, closed options and opaque cancellation before lazy database acquisition', async () => {
	let opens = 0, probes = 0;
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: { open() { opens++; throw new Error('No open allowed'); } } as unknown as IDBFactory,
		verifyOriginal: async () => undefined });
	try {
		for (const selected of [undefined, '', 'bad|id', {}, 17]) await assert.rejects(repository.readSmartCollectionSnapshotV1('catalog', selected as string));
		for (const invalid of [{ future: true }, { continuation: null }, { signal: {} }, { [Symbol('hidden')]: true },
			Object.defineProperty({}, 'signal', { enumerable: true, get() { probes++; return undefined; } })]) {
			await assert.rejects(repository.readSmartCollectionSnapshotV1('catalog', null, invalid));
		}
		for (const reason of [17, null, new Proxy({}, { get() { probes++; throw new Error('Opaque'); }, getPrototypeOf() { probes++; throw new Error('Opaque'); } })]) {
			await repository.readSmartCollectionSnapshotV1('catalog', null, { signal: AbortSignal.abort(reason) }).then(() => assert.fail('Expected cancellation'), error => { assert.ok(error === reason); });
		}
		assert.equal(opens, 0); assert.equal(probes, 0);
	} finally { await repository.close(); }
});

test('snapshot cancellation joins its readonly transaction and preserves the exact opaque reason without caller signal accessors', async () => {
	const f = await fixture(); f.seed(1); const stop = new AbortController(); let probes = 0;
	const reason = new Proxy({}, { get() { probes++; throw new Error('Opaque'); }, getPrototypeOf() { probes++; throw new Error('Opaque'); } });
	try {
		const before = contents(f);
		f.indexedDB.onNextGetForStore('photoSmartCollections', () => {
			Object.defineProperty(stop.signal, 'aborted', { get() { probes++; return false; } }); stop.abort(reason);
		});
		await f.repository.readSmartCollectionSnapshotV1('catalog', 'saved-0000', { signal: stop.signal })
			.then(() => assert.fail('Expected cancellation'), error => { assert.ok(error === reason); });
		assert.equal(probes, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0); assert.deepEqual(contents(f), before);
	} finally { await close(f); }
});
