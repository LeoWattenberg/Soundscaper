/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPhotoCatalogRestoreStageV1 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v1.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { savedArchiveDefinitionV3, savedArchiveRootV3, savedArchiveStateV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { stackArchiveRecord } from './helpers/lightscaper-stack-archive-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previousKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previousKeyRange) Object.defineProperty(globalThis, 'IDBKeyRange', previousKeyRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

const DATABASE = 'private-catalog-restore';
function fixture(deleteGate?: ReturnType<typeof deferred<void>>) {
	const indexedDB = createInstrumentedIndexedDB(), deleted: string[] = []; let opens = 0;
	const factory = { ...indexedDB, open(name: string, version?: number) { opens++; return indexedDB.open(name, version); }, deleteDatabase(name: string) {
		deleted.push(name);
		const request = { onsuccess: null as ((event: Event) => void) | null, onerror: null, onblocked: null, error: null };
		void (deleteGate?.promise ?? Promise.resolve()).then(() => request.onsuccess?.(new Event('success')));
		return request;
	} } as unknown as IDBFactory;
	return { indexedDB, factory, deleted, opens: () => opens };
}
function database(factory: IDBFactory, version = 5): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = factory.open(DATABASE, version);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
}

test('catalog-only restore preserves archived revisions and derives exact ready projections', async () => {
	const f = fixture(), root = { ...savedArchiveRootV3(), revision: Number.MAX_SAFE_INTEGER };
	const savedState = savedArchiveStateV3(1, Number.MAX_SAFE_INTEGER);
	const stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE, root, savedState });
	const photos = [1, 2].map(index => normalizePhotoDocumentV1({ ...photoArchiveFixture(index).photo, revision: Number.MAX_SAFE_INTEGER }));
	const stack = { ...stackArchiveRecord(), revision: Number.MAX_SAFE_INTEGER };
	const definition = { ...savedArchiveDefinitionV3(), revision: Number.MAX_SAFE_INTEGER };
	try {
		for (const photo of photos) await stage.writePhoto(photo);
		await stage.writeStack(stack); await stage.writeSavedCollection(definition);
		const result = await stage.finish();
		assert.deepEqual(result, { databaseName: DATABASE, catalogId: root.id, catalogRevision: root.revision,
			photoCount: 2, stackCount: 1, savedCollectionCount: 1, indexRevision: 0 });
		assert.deepEqual(f.indexedDB.records(DATABASE, 'catalogs'), [root]);
		assert.deepEqual(f.indexedDB.records(DATABASE, 'photos').map((row: { document: unknown }) => row.document), photos);
		assert.deepEqual(f.indexedDB.records(DATABASE, 'photoStacks').map((row: { document: unknown }) => row.document), [stack]);
		assert.deepEqual(f.indexedDB.records(DATABASE, 'photoSmartCollections').map((row: { document: unknown }) => row.document), [definition]);
		assert.deepEqual(f.indexedDB.records(DATABASE, 'photoSmartCollectionStates'), [savedState]);
		assert.equal(f.indexedDB.records(DATABASE, 'photoQueryBuildStatesV2')[0].ready, true);
		assert.equal(f.indexedDB.records(DATABASE, 'photoStackStates')[0].revision, 0);
		await assert.rejects(stage.writePhoto(photos[0]), /finished|closed|retired/iu);
	} finally { await stage.close(); }
	assert.equal(f.indexedDB.stats.activeTransactions, 0); assert.deepEqual(f.deleted, []);
});

for (const savedState of [null, savedArchiveStateV3(0, 0), savedArchiveStateV3(0, 99)]) {
	test(`physical saved state ${savedState?.revision ?? 'absent'} survives candidate readiness`, async () => {
		const f = fixture(), root = savedArchiveRootV3(0);
		const stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE, root, savedState });
		try {
			await stage.finish();
			assert.deepEqual(f.indexedDB.records(DATABASE, 'photoSmartCollectionStates'), savedState === null ? [] : [savedState]);
			assert.equal(f.indexedDB.records(DATABASE, 'catalogs')[0].revision, root.revision);
		} finally { await stage.close(); }
	});
}

test('the first child write failure retires all mutation and finish admission', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(1), savedState: null });
	try {
		await assert.rejects(stage.writePhoto({ ...photoArchiveFixture(1).photo, catalogId: 'foreign' }));
		const writes = f.indexedDB.records(DATABASE, 'photos').length;
		await assert.rejects(stage.writePhoto(photoArchiveFixture(1).photo), /failed|retired/iu);
		await assert.rejects(stage.finish(), /failed|retired/iu);
		assert.equal(f.indexedDB.records(DATABASE, 'photos').length, writes);
	} finally { await stage.rollback(); }
	assert.deepEqual(f.deleted, [DATABASE]);
});

test('a fresh restore creates precisely the existing catalog schema without timeline stores', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(0), savedState: null });
	try {
		const current = await database(f.factory);
		assert.deepEqual([...current.objectStoreNames].sort(), [...PHOTO_CATALOG_STORES].sort());
		assert.equal(current.transaction('photoStacks').objectStore('photoStacks').index('memberKey').unique, true);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
	} finally { await stage.rollback(); }
});

for (const closeFirst of [false, true]) test(`rollback keeps the deletion barrier after prior close=${closeFirst}`, async () => {
	const release = deferred<void>(), f = fixture(release), options = { indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(0), savedState: null };
	const stage = await createPhotoCatalogRestoreStageV1(options);
	if (closeFirst) await stage.close();
	const work = stage.rollback();
	try {
		assert.equal(await remainsPending(work), true);
		const opens = f.opens();
		await assert.rejects(createPhotoCatalogRestoreStageV1(options), /already owns/iu);
		assert.equal(f.opens(), opens);
		assert.deepEqual(f.deleted, [DATABASE]);
	} finally { release.resolve(); await work; }
});

test('a child admission detaches caller data before returning its pending promise', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(1), savedState: null });
	const source = photoArchiveFixture(1).photo, raw = { ...source, metadata: { ...source.metadata } };
	try {
		const write = stage.writePhoto(raw); raw.metadata.title = 'Changed after admission'; await write;
		assert.equal(f.indexedDB.records(DATABASE, 'photos')[0].document.metadata.title, source.metadata.title);
	} finally { await stage.rollback(); }
});

test('ordered stack and complete saved-query admissions detach before their first native await', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(), savedState: savedArchiveStateV3(1) });
	const sourceStack = stackArchiveRecord(), stack = { ...sourceStack, photoIds: [...sourceStack.photoIds] };
	const sourceDefinition = savedArchiveDefinitionV3(), definition = { ...sourceDefinition, query: { ...sourceDefinition.query } };
	try {
		for (const index of [1, 2]) await stage.writePhoto(photoArchiveFixture(index).photo);
		const stackWrite = stage.writeStack(stack); stack.photoIds.reverse(); stack.coverPhotoId = stack.photoIds[0]; await stackWrite;
		const savedWrite = stage.writeSavedCollection(definition); definition.name = 'Changed'; definition.query.text = 'Changed'; await savedWrite;
		assert.deepEqual(f.indexedDB.records(DATABASE, 'photoStacks')[0].document, sourceStack);
		assert.deepEqual(f.indexedDB.records(DATABASE, 'photoSmartCollections')[0].document, sourceDefinition);
		await stage.finish();
	} finally { await stage.rollback(); }
});

test('raw reflection cannot reenter the stage before synchronous admission owns its latch', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(1), savedState: null });
	let reentry: Promise<void> | undefined, failure: unknown, inspected = 0;
	const second = new Proxy(photoArchiveFixture(1).photo, { getOwnPropertyDescriptor(target, key) {
		inspected++; return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	const source = new Proxy(photoArchiveFixture(1).photo, { ownKeys(target) {
		if (!reentry) reentry = stage.writePhoto(second).catch((error: unknown) => { failure = error; });
		return Reflect.ownKeys(target);
	} });
	try {
		await stage.writePhoto(source); await reentry;
		assert.ok(failure instanceof Error); assert.match(failure.message, /pending/iu); assert.equal(inspected, 0);
		assert.equal(f.indexedDB.records(DATABASE, 'photos').length, 1); await stage.finish();
	} finally { await stage.rollback(); }
});

test('failed readiness authentication permanently retires mutation without a ready control ACK', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(1), savedState: null });
	try {
		await stage.writePhoto(photoArchiveFixture(1).photo);
		const summary = f.indexedDB.records(DATABASE, 'summaries')[0];
		f.indexedDB.seedRecord(DATABASE, 'summaries', { ...summary, fileName: 'Forged projection' });
		await assert.rejects(stage.finish(), /projection|differs/iu);
		await assert.rejects(stage.finish(), /finished|closed|retired/iu);
		await assert.rejects(stage.writePhoto(photoArchiveFixture(1).photo), /finished|closed|retired/iu);
		assert.equal(f.indexedDB.records(DATABASE, 'photoQueryBuildStatesV2')[0].ready, false);
	} finally { await stage.rollback(); }
});

test('rollback retires new child admission synchronously in the same gesture', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(1), savedState: null });
	const rollback = stage.rollback();
	let inspected = 0;
	const photo = new Proxy(photoArchiveFixture(1).photo, { getOwnPropertyDescriptor(target, key) { inspected++; return Reflect.getOwnPropertyDescriptor(target, key); } });
	await assert.rejects(stage.writePhoto(photo), /closed|retired/iu); assert.equal(inspected, 0);
	await rollback; assert.equal(f.indexedDB.records(DATABASE, 'photos').length, 0);
});
