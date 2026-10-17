/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoDocumentV2, serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { readStoredPhotoV1OrV2 } from '../src/lightscaper/catalog/photo-catalog-records-v2.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
const DATABASE = 'photo-current', CREATED = '2026-10-09T00:00:00.000Z';
const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Current', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
function successor(index = 1, neutral = false) {
	const photo = photoArchiveFixture(index).photo;
	const develop = { ...defaultImageDevelopStateV1(), processVersion: 2, effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false,
		params: { lut: neutral ? null : { storageKey: `lut-sha256:${'4'.repeat(64)}`, sha256: '4'.repeat(64), byteLength: 88, size: 2,
			domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }] };
	let workspace = createPhotoDevelopWorkspaceV2(photo.versions[0]!.develop, { label: 'Original', createdAt: CREATED });
	workspace = commitPhotoDevelopWorkspaceV2(workspace, develop, { label: 'LUT', createdAt: CREATED });
	workspace = { ...workspace, snapshots: [{ id: 'snapshot', name: 'Saved', createdAt: CREATED, develop: workspace.entries[1]!.develop }] };
	workspace = selectPhotoDevelopHistoryV2(workspace, 0);
	return normalizePhotoDocumentV2({ ...photo, schemaVersion: 2, versions: [{ ...photo.versions[0], workspace }] });
}
function fixture(verifyResources?: (photo: unknown, signal?: AbortSignal) => Promise<void>) {
	const raw = createInstrumentedIndexedDB(), indexedDB = raw as unknown as IDBFactory;
	const create = () => new PhotoCatalogRepositoryV2({ indexedDB, databaseName: DATABASE, verifyOriginal: async () => undefined,
		...(verifyResources ? { verifyResources } : {}) });
	return { raw, indexedDB, create, repository: create() };
}

test('mixed Photo1/2 publication keeps old bytes and exact whole successors through close/reopen', async () => {
	const f = fixture(async () => undefined), legacy = photoArchiveFixture(2).photo, current = successor();
	await f.repository.createCatalog(root()); await f.repository.publishPhotos(root().id, 0, [current, legacy]);
	assert.equal((await f.repository.loadCatalog(root().id))?.schemaVersion, 1);
	assert.deepEqual(await f.repository.loadPhoto(root().id, current.id), current);
	assert.equal(serializePhotoDocumentV1OrV2(await f.repository.loadPhoto(root().id, legacy.id)), serializeLightscaperDocumentV1(legacy));
	const rows = await f.repository.readSummaryPage(root().id); assert.equal(rows.items.length, 2);
	await f.repository.close(); const reopened = f.create();
	assert.deepEqual(await reopened.loadPhoto(root().id, current.id), current);
	const old = new PhotoCatalogRepositoryV1({ indexedDB: f.indexedDB, databaseName: DATABASE, verifyOriginal: async () => undefined });
	await assert.rejects(old.loadPhoto(root().id, current.id)); await assert.rejects(old.savePhoto(current, 0));
	assert.deepEqual(await old.loadPhoto(root().id, legacy.id), legacy);
	await Promise.all([old.close(), reopened.close()]);
});

test('Photo2 metadata edits retain process1 selection and all inactive/redo/snapshot references', async () => {
	const f = fixture(async () => undefined), current = successor(); await f.repository.createCatalog(root());
	await f.repository.publishPhotos(root().id, 0, [current]);
	const next = await f.repository.savePhoto({ ...current, metadata: { ...current.metadata, title: 'Edited' } }, 0);
	assert.equal(next.schemaVersion, 2); assert.equal(next.revision, 1); assert.equal(next.versions[0]?.develop.processVersion, 1);
	assert.deepEqual(next.versions, current.versions); assert.deepEqual(next.original, current.original);
	assert.equal((await f.repository.readSnapshot(root().id))?.indexRevision, 2);
	await assert.rejects(f.repository.savePhoto({ ...next, schemaVersion: 1 }, 1));
	const neutral = normalizePhotoDocumentV2({ ...photoArchiveFixture(3).photo, schemaVersion: 2 });
	await f.repository.publishPhotos(root().id, 1, [neutral]);
	await assert.rejects(f.repository.savePhoto({ ...neutral, schemaVersion: 1 }, 0), /downgraded/iu);
	await assert.rejects(f.repository.savePhoto({ ...current, rating: 1 }, 0), { code: 'PHOTO_REVISION_CONFLICT' });
	for (const patch of [{ original: { ...next.original, name: 'Changed' } }, { extractedMetadata: {} }]) {
		await assert.rejects(f.repository.savePhoto({ ...next, ...patch }, 1));
	}
	assert.deepEqual(await f.repository.loadPhoto(root().id, current.id), next); await f.repository.close();
});

test('resource reachability requires a verifier for disabled and redo-only refs but null/legacy do no body IO', async () => {
	const f = fixture(); await f.repository.createCatalog(root());
	await assert.rejects(f.repository.publishPhotos(root().id, 0, [successor()]), /resource/iu);
	assert.equal(f.raw.recordCount(DATABASE, 'photos'), 0);
	await f.repository.publishPhotos(root().id, 0, [successor(1, true), photoArchiveFixture(2).photo]);
	await f.repository.close();
	let calls = 0; const verified = fixture(async photo => { calls++; assert.deepEqual(photo, successor()); });
	await verified.repository.createCatalog(root()); await verified.repository.publishPhotos(root().id, 0, [successor()]);
	assert.equal(calls, 1); await verified.repository.close();
});

test('constructor pins resource callback receiver before asynchronous admission', async () => {
	const raw = createInstrumentedIndexedDB(), entered = deferred<void>(), release = deferred<void>(); let called = 0;
	const options = { indexedDB: raw as unknown as IDBFactory, databaseName: DATABASE, verifyOriginal: async () => undefined,
		async verifyResources(this: unknown) { assert.equal(this, options); called++; entered.resolve(); await release.promise; } };
	const repository = new PhotoCatalogRepositoryV2(options); await repository.createCatalog(root());
	const work = repository.publishPhotos(root().id, 0, [successor()]); await entered.promise;
	options.verifyResources = async () => { throw new Error('Replaced callback used.'); }; release.resolve(); await work;
	assert.equal(called, 1); await repository.savePhoto({ ...successor(), rating: 3 }, 0); assert.equal(called, 2); await repository.close();
});

test('held resource verification cancellation and Close stay joined and publish no native rows', async () => {
	for (const closing of [false, true]) {
		const entered = deferred<void>(), release = deferred<void>(), cancel = new AbortController(); let inspections = 0;
		const reason = new Proxy({}, { get() { inspections++; throw Error('Opaque access'); }, getPrototypeOf() { inspections++; throw Error('Opaque prototype'); } });
		const f = fixture(async (_photo, signal) => { entered.resolve(); await release.promise; signal?.throwIfAborted(); });
		await f.repository.createCatalog(root()); let failure: unknown;
		const work = f.repository.publishPhotos(root().id, 0, [successor()], { signal: cancel.signal }).catch((error: unknown) => { failure = error; });
		await entered.promise; assert.equal(f.raw.stats.activeTransactions, 0); const closed = closing ? f.repository.close() : null; if (!closing) cancel.abort(reason);
		assert.equal(await remainsPending(work), true); if (closed) assert.equal(await remainsPending(closed), true);
		assert.equal(f.raw.recordCount(DATABASE, 'photos'), 0); release.resolve(); await work; await closed;
		if (!closing) assert.equal(failure, reason); assert.equal(inspections, 0); assert.equal(f.raw.recordCount(DATABASE, 'photos'), 0);
		await f.repository.close();
	}
});

test('physical requested key, closed wrapper and missing documents cannot be substituted', async () => {
	const f = fixture(), photo = photoArchiveFixture().photo; await f.repository.createCatalog(root());
	assert.equal(await f.repository.loadPhoto(root().id, photo.id), null);
	for (const row of [{ key: `catalog-1|${photo.id}`, document: photo }, { key: 'catalog-1|wrong', document: photo },
		{ key: 'catalog-1|wrong' }, { key: 'catalog-1|wrong', document: undefined }, { key: 'catalog-1|wrong', document: photo, future: 1 }]) {
		f.raw.seedRecord(DATABASE, 'photos', row, 'catalog-1|wrong'); await assert.rejects(f.repository.loadPhoto(root().id, 'wrong'));
	}
	assert.throws(() => readStoredPhotoV1OrV2({ key: `catalog-1|${photo.id}`, document: photo }, 'catalog-1|other'));
	await assert.rejects(f.repository.savePhoto(photo, 0), /missing/iu); await f.repository.close();
});

test('all native photo/index failures roll back the complete current publication', async () => {
	for (const store of ['photos', 'summaries', 'memberships', 'catalogStates', 'catalogs', 'photoQueryRows', 'photoQueryRowsV2', 'photoQueryBuildStates', 'photoQueryBuildStatesV2']) {
		const f = fixture(async () => undefined); await f.repository.createCatalog(root());
		f.raw.failNextPutForStore(store, new DOMException('Refused', 'QuotaExceededError'));
		await assert.rejects(f.repository.publishPhotos(root().id, 0, [successor()]));
		for (const key of ['photos', 'summaries', 'memberships', 'photoQueryRows', 'photoQueryRowsV2']) assert.equal(f.raw.recordCount(DATABASE, key), 0, store);
		assert.equal((await f.repository.loadCatalog(root().id))?.photoCount, 0); await f.repository.close();
	}
});

test('native completion ACK wins a held completion cancellation while Close joins delivery', async () => {
	const f = fixture(), photo = photoArchiveFixture().photo; await f.repository.createCatalog(root());
	const db = await openPhotoCatalogDatabaseV1(f.indexedDB, DATABASE, () => undefined), transaction = db.transaction.bind(db);
	const entered = deferred<void>(), release = deferred<void>(), cancel = new AbortController(); let armed = true;
	db.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const tx = transaction(names, mode);
		if (armed && mode === 'readwrite') { armed = false; let complete: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(tx, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { complete = value; },
				get() { return (event: Event) => { entered.resolve(); cancel.abort(); void release.promise.then(() => complete?.call(tx, event)); }; } }); }
		return tx;
	}) as IDBDatabase['transaction'];
	const work = f.repository.publishPhotos(root().id, 0, [photo], { signal: cancel.signal });
	await entered.promise; const closing = f.repository.close(); assert.equal(await remainsPending(closing), true);
	release.resolve(); assert.equal((await work).photoCount, 1); await closing;
	assert.equal(f.raw.recordCount(DATABASE, 'photos'), 1); db.transaction = transaction; db.close();
});


test('preflight detaches the whole candidate before verifier waits and rejects already-aborted demand without callbacks', async () => {
	const entered = deferred<void>(), release = deferred<void>(); let calls = 0;
	const f = fixture(async () => { calls++; entered.resolve(); await release.promise; }); await f.repository.createCatalog(root());
	const candidate = JSON.parse(JSON.stringify(successor())) as { metadata: { title: string }; id: string }, work = f.repository.publishPhotos(root().id, 0, [candidate]);
	await entered.promise; candidate.metadata.title = 'Changed during wait'; release.resolve(); await work;
	assert.equal((await f.repository.loadPhoto(root().id, candidate.id))?.metadata.title, successor().metadata.title);
	const cancel = new AbortController(), reason = Object.freeze({ cancelled: true }); cancel.abort(reason); let failure: unknown;
	try { await f.repository.savePhoto(successor(), 0, { signal: cancel.signal }); } catch (error) { failure = error; }
	assert.equal(failure, reason); assert.equal(calls, 1); await f.repository.close();
});

test('safe revision and catalog reference refusals never publish a partial current document', async () => {
	const f = fixture(), photo = photoArchiveFixture().photo; await f.repository.createCatalog(root()); await f.repository.publishPhotos(root().id, 0, [photo]);
	await assert.rejects(f.repository.savePhoto({ ...photo, keywordIds: ['unknown'] }, 0), /keyword/iu);
	f.raw.seedRecord(DATABASE, 'photos', { key: `catalog-1|${photo.id}`, document: { ...photo, revision: Number.MAX_SAFE_INTEGER } });
	await assert.rejects(f.repository.savePhoto({ ...photo, revision: Number.MAX_SAFE_INTEGER }, Number.MAX_SAFE_INTEGER));
	assert.equal((await f.repository.loadPhoto(root().id, photo.id))?.revision, Number.MAX_SAFE_INTEGER);
	assert.equal((await f.repository.readSnapshot(root().id))?.indexRevision, 1); await f.repository.close();
});

test('Close retains a native connection close failure and remains idempotently settled', async () => {
	const f = fixture(); await f.repository.createCatalog(root());
	const db = await openPhotoCatalogDatabaseV1(f.indexedDB, DATABASE, () => undefined), originalClose = db.close.bind(db), failure = new Error('Close refused');
	db.close = () => { originalClose(); throw failure; };
	const closing = f.repository.close(); await assert.rejects(closing, error => error === failure); assert.equal(f.repository.close(), closing);
});


test('resource failures and asynchronous projection-shaped failures remain exact atomic refusals', async () => {
	const opaque = new Proxy({}, { get() { throw Error('Opaque access'); }, getPrototypeOf() { throw Error('Opaque prototype'); } });
	const f = fixture(async () => { throw opaque; }); await f.repository.createCatalog(root()); let failure: unknown;
	try { await f.repository.publishPhotos(root().id, 0, [successor()]); } catch (error) { failure = error; }
	assert.equal(failure, opaque); assert.equal(f.raw.recordCount(DATABASE, 'photos'), 0); await f.repository.close();
	const g = fixture(); await g.repository.createCatalog(root()); const quota = new RangeError('Photo query row exceeds its byte budget.');
	g.raw.failNextPutForStore('photoQueryRows', quota);
	await assert.rejects(g.repository.publishPhotos(root().id, 0, [photoArchiveFixture().photo]), error => error === quota);
	assert.equal(g.raw.recordCount(DATABASE, 'photos'), 0); assert.equal((await g.repository.loadCatalog(root().id))?.photoCount, 0); await g.repository.close();
});

test('facade routes mixed source rebuild and native metadata edits through both unchanged query profiles', async () => {
	const f = fixture(), current = successor(1, true), legacy = photoArchiveFixture(2).photo; await f.repository.createCatalog(root());
	const populated = { ...root(), revision: 1, photoCount: 2 };
	f.raw.seedRecord(DATABASE, 'catalogs', populated);
	f.raw.seedRecord(DATABASE, 'catalogStates', { id: populated.id, schemaFamily: 'lightscaper', schemaVersion: 1, rootRevision: 1, indexRevision: 1, photoCount: 2 });
	for (const photo of [current, legacy]) f.raw.seedRecord(DATABASE, 'photos', { key: `catalog-1|${photo.id}`, document: photo });
	for (const [store, schemaVersion] of [['photoQueryBuildStates', 1], ['photoQueryBuildStatesV2', 2]] as const) {
		f.raw.seedRecord(DATABASE, store, { id: populated.id, schemaVersion, ready: false, afterKey: null, indexedCount: 0 });
	}
	assert.equal((await f.repository.rebuildQueryIndexPage(populated.id)).ready, true);
	assert.equal((await f.repository.rebuildQueryIndexPageV2(populated.id)).ready, true);
	assert.deepEqual((await f.repository.readQueryPage(populated.id)).items, (await f.repository.readQueryPageV2(populated.id)).items);
	const saved = await f.repository.savePhoto({ ...current, metadata: { ...current.metadata, title: 'Needle' }, rating: 5 }, 0);
	const first = await f.repository.readQueryPage(populated.id, { query: { text: 'Needle' } });
	const second = await f.repository.readQueryPageV2(populated.id, { query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Needle' } });
	assert.deepEqual(first.items, second.items); assert.equal(first.items[0]?.photoRevision, saved.revision); assert.equal(first.items[0]?.rating, 5);
	await f.repository.close();
});

test('callable verifier capture never reads borrowed bind/name/length properties', async () => {
	for (const mode of ['resource', 'original'] as const) {
		const raw = createInstrumentedIndexedDB(); let inspections = 0, originals = 0, resources = 0;
		const original = async function (this: unknown) { assert.equal(this, options); originals++; };
		const resource = async function (this: unknown) { assert.equal(this, options); resources++; };
		const guarded = <Callback extends (...args: never[]) => unknown>(callback: Callback) => new Proxy(callback, {
			get() { inspections++; throw Error('Verifier function reflected'); } });
		const options = { indexedDB: raw as unknown as IDBFactory, databaseName: DATABASE,
			verifyOriginal: mode === 'original' ? guarded(original) : original,
			verifyResources: mode === 'resource' ? guarded(resource) : resource };
		const repository = new PhotoCatalogRepositoryV2(options); await repository.createCatalog(root());
		await repository.publishPhotos(root().id, 0, [successor()]);
		assert.equal(originals, 1); assert.equal(resources, 1); assert.equal(inspections, 0); await repository.close();
	}
});
