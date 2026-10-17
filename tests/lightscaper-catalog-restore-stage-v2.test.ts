/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPhotoCatalogRestoreStageV2 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v2.ts';
import { createPhotoCatalogRestoreStageV1 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { photoCatalogRestorePhotoRecordsV2 } from '../src/lightscaper/catalog/photo-catalog-restore-records-v2.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { lutArchiveFixture } from './helpers/lightscaper-lut-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const DATABASE = 'private-current-catalog';

function fixture() {
	const indexedDB = createInstrumentedIndexedDB(), deleted: string[] = [];
	const deletion = deferred<void>(); let deletionHeld = false;
	const factory = { ...indexedDB, deleteDatabase(name: string) {
		deleted.push(name); const result = { onsuccess: null as ((event: Event) => void) | null, onerror: null, onblocked: null, error: null };
		void (deletionHeld ? deletion.promise : Promise.resolve()).then(() => result.onsuccess?.(new Event('success')));
		return result;
	} } as unknown as IDBFactory;
	return { indexedDB, factory, deleted, deletion, holdDeletion() { deletionHeld = true; } };
}
async function database(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = factory.open(DATABASE, 5);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
}

test('named current restore preserves complete mixed Photo1/2 bytes and exact production projections on reopen', async () => {
	const f = fixture(), current = lutArchiveFixture(), old = photoArchiveFixture(2).photo;
	const root = { ...current.root, photoCount: 2 }, stage = await createPhotoCatalogRestoreStageV2({
		indexedDB: f.factory, databaseName: DATABASE, root, savedState: null });
	try {
		await stage.writePhoto(current.record.photo); await stage.writePhoto(old);
		const ack = await stage.finish(); assert.equal(ack.photoCount, 2); assert.equal(ack.catalogRevision, root.revision);
		for (const photo of [current.record.photo, old]) {
			const rows = photoCatalogRestorePhotoRecordsV2(root, photo);
			assert.deepEqual(f.indexedDB.records(DATABASE, 'photos').find((row: { key: string }) => row.key === rows.photo.key), rows.photo);
			assert.deepEqual(f.indexedDB.records(DATABASE, 'summaries').find((row: { key: string }) => row.key === rows.photo.key), rows.summary);
			assert.deepEqual(f.indexedDB.records(DATABASE, 'photoQueryRowsV2').find((row: { key: string }) => row.key === rows.photo.key), rows.queryV2);
		}
		const db = await database(f.factory); assert.deepEqual([...db.objectStoreNames].sort(), [...PHOTO_CATALOG_STORES].sort()); db.close();
		assert.equal(f.indexedDB.records(DATABASE, 'photoQueryBuildStatesV2')[0].ready, true);
		await stage.close();
		const repository = new PhotoCatalogRepositoryV2({ indexedDB: f.factory, databaseName: DATABASE,
			verifyOriginal: async () => undefined, verifyResources: async () => undefined });
		try { assert.deepEqual(await repository.loadPhoto(root.id, current.record.photo.id), current.record.photo);
			assert.deepEqual(await repository.loadPhoto(root.id, old.id), old); } finally { await repository.close(); }
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { await stage.close(); }
});

test('old named restore stays strict while current delivery refuses full-document drift before native readiness', async () => {
	const current = lutArchiveFixture(), legacy = fixture();
	const old = await createPhotoCatalogRestoreStageV1({ indexedDB: legacy.factory, databaseName: DATABASE, root: current.root, savedState: null });
	try { await assert.rejects(old.writePhoto(current.record.photo)); } finally { await old.rollback(); }
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV2({ indexedDB: f.factory, databaseName: DATABASE, root: current.root, savedState: null });
	try {
		await stage.writePhoto(current.record.photo);
		const photo = normalizePhotoDocumentV2({ ...current.record.photo, revision: current.record.photo.revision + 1 });
		const stored = f.indexedDB.records(DATABASE, 'photos')[0]; f.indexedDB.seedRecord(DATABASE, 'photos', { ...stored, document: photo });
		await assert.rejects(stage.finish(), /delivered|delivery|differs/iu);
		assert.equal(f.indexedDB.records(DATABASE, 'photoQueryBuildStatesV2')[0].ready, false);
		await assert.rejects(stage.writePhoto(current.record.photo), /closed|retired/iu);
	} finally { await stage.rollback(); }
});

test('current photo admission detaches before awaits and owns reflection reentry before reading a second document', async () => {
	const f = fixture(), current = lutArchiveFixture(), stage = await createPhotoCatalogRestoreStageV2({
		indexedDB: f.factory, databaseName: DATABASE, root: current.root, savedState: null });
	let pending: Promise<void> | undefined, inspected = 0;
	const second = new Proxy(current.record.photo, { ownKeys(target) { inspected++; return Reflect.ownKeys(target); } });
	const source = structuredClone(current.record.photo);
	const first = new Proxy(source, { ownKeys(target) { pending ??= stage.writePhoto(second).catch((error: unknown) => {
		assert.ok(error instanceof Error); assert.match(error.message, /pending/iu);
	}); return Reflect.ownKeys(target); } });
	try {
		const writing = stage.writePhoto(first); Reflect.set(source.metadata, 'title', 'Changed after admission'); await writing; await pending;
		assert.equal(inspected, 0); assert.deepEqual(f.indexedDB.records(DATABASE, 'photos')[0].document, current.record.photo);
		await stage.finish();
	} finally { await stage.rollback(); }
});

test('native final readiness completion remains joined through Close and its durable ACK wins late cancellation', async () => {
	const f = fixture(), current = lutArchiveFixture(), stage = await createPhotoCatalogRestoreStageV2({
		indexedDB: f.factory, databaseName: DATABASE, root: current.root, savedState: null });
	await stage.writePhoto(current.record.photo);
	const db = await database(f.factory), transaction = db.transaction, entered = deferred<void>(), release = deferred<void>();
	db.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
		const result = Reflect.apply(transaction, this, args) as IDBTransaction;
		if (args[1] === 'readwrite' && Array.isArray(args[0]) && args[0].length === PHOTO_CATALOG_STORES.length) {
			let listener: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(result, 'oncomplete', { configurable: true, get() { return (event: Event) => {
				entered.resolve(); void release.promise.then(() => { if (listener) Reflect.apply(listener, result, [event]); });
			}; }, set(value: IDBTransaction['oncomplete']) { listener = value; } });
		}
		return result;
	};
	const finishing = stage.finish(); await entered.promise; const closing = stage.close();
	try { assert.equal(await remainsPending(finishing), true); assert.equal(await remainsPending(closing), true);
		release.resolve(); const ack = await finishing; await closing; assert.equal(ack.photoCount, 1);
		assert.equal(f.indexedDB.records(DATABASE, 'photoQueryBuildStatesV2')[0].ready, true);
	} finally { release.resolve(); db.transaction = transaction; await closing; }
});

test('current fresh rollback retains its name barrier until native deletion completes, including after Close', async () => {
	const f = fixture(), current = lutArchiveFixture(), options = { indexedDB: f.factory, databaseName: DATABASE,
		root: { ...current.root, photoCount: 0 }, savedState: null };
	const stage = await createPhotoCatalogRestoreStageV2(options); await stage.close(); f.holdDeletion();
	const rollback = stage.rollback();
	try { assert.equal(await remainsPending(rollback), true); await assert.rejects(createPhotoCatalogRestoreStageV2(options), /already owns/iu);
		assert.deepEqual(f.deleted, [DATABASE]); } finally { f.deletion.resolve(); await rollback; }
});

test('native abort reentry reuses the cached rollback join and starts exactly one held deletion', async () => {
	const f = fixture(), current = lutArchiveFixture(), options = { indexedDB: f.factory, databaseName: DATABASE, root: current.root, savedState: null };
	const stage = await createPhotoCatalogRestoreStageV2(options), db = await database(f.factory);
	const transaction = db.transaction, entered = deferred<void>(), release = deferred<void>();
	let nested: Promise<void> | undefined, reentered = false;
	db.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
		const result = Reflect.apply(transaction, this, args) as IDBTransaction;
		if (args[1] !== 'readwrite' || !Array.isArray(args[0]) || !args[0].includes('photos')) return result;
		const abort = result.abort;
		result.abort = () => { if (!reentered) { reentered = true; nested = stage.rollback(); } Reflect.apply(abort, result, []); };
		let handler: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(result, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { handler = value; },
			get() { return (event: Event) => { entered.resolve(); void release.promise.then(() => { if (handler) Reflect.apply(handler, result, [event]); }); }; } });
		return result;
	};
	const writing = stage.writePhoto(current.record.photo); await entered.promise; f.holdDeletion(); const rollback = stage.rollback();
	try {
		assert.equal(nested, rollback); assert.equal(stage.rollback(), rollback);
		release.resolve(); await assert.rejects(writing, /closed/iu); assert.equal(await remainsPending(rollback), true);
		assert.deepEqual(f.deleted, [DATABASE]); await assert.rejects(createPhotoCatalogRestoreStageV2(options), /already owns/iu);
	} finally {
		release.resolve(); f.deletion.resolve(); await Promise.allSettled([writing, rollback, ...(nested ? [nested] : [])]); db.transaction = transaction;
	}
});
