/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1 } from '../src/lightscaper/catalog/photo-cube-lut-closure-v1.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoCatalogQueryV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
const DATABASE = 'repair-current', CREATED = '2026-10-11T00:00:00.000Z';
const root = () => normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
	id: 'catalog-1', name: 'Repairs', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
const digest = (index: number) => index.toString(16).padStart(64, '0');
function develop(index = 1, resources = false) {
	const base = defaultImageDevelopStateV1();
	return replaceImageDevelopRepairSpotsV1(resources ? { ...base, processVersion: 2,
		effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: {
			lut: { storageKey: `lut-sha256:${digest(index)}`, sha256: digest(index), byteLength: 73, size: 2,
				domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }],
		masks: [{ schemaVersion: 2, id: 'brush', name: 'Retained brush', kind: 'mask',
			inputs: [{ name: 'Brush', sourceRef: `brush-mask-v1:1:1:${digest(index + 100)}`, kind: 'raster' },
				{ name: 'Unused', sourceRef: `brush-mask-v1:1:1:${digest(index + 200)}`, kind: 'raster' }],
			nodes: [{ id: 'out', kind: 'raster', inputName: 'Brush', channel: 'alpha' }], outputNodeId: 'out' }],
		maskBindings: [] } : base,
	{ schemaVersion: 1, spots: [{ id: `repair-${String(index)}`, mode: 'clone', enabled: false,
		target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 0.1, feather: 0.2, opacity: 0.5 }] });
}
function photo(index = 1, resources = false, resourceOffset = 0) {
	const original = photoArchiveFixture(index).photo, master = original.versions[0]!;
	return { ...original, schemaVersion: 3 as const, versions: [{ ...master,
		workspace: { schemaVersion: 3, kind: 'photo-develop-workspace', entries: [
			{ label: 'Original', createdAt: CREATED, develop: master.develop },
			{ label: 'Repair redo', createdAt: CREATED, develop: develop(1 + resourceOffset, resources) }], cursor: 0,
			snapshots: [{ id: 'repair-snapshot', name: 'Repair snapshot', createdAt: CREATED, develop: develop(2 + resourceOffset, resources) }] } },
	{ ...master, id: `copy-${String(index)}`, kind: 'virtual-copy', name: 'Inactive repair', develop: develop(3 + resourceOffset, resources) }] };
}
function fixture(verifyResources?: (value: unknown, signal?: AbortSignal) => Promise<void>) {
	const raw = createInstrumentedIndexedDB(), indexedDB = raw as unknown as IDBFactory;
	const create = () => new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: DATABASE,
		verifyOriginal: async () => undefined, ...(verifyResources ? { verifyResources } : {}) });
	return { raw, indexedDB, create, repository: create() };
}

test('repair aggregate retains active legacy, redo, snapshots and inactive recipes through catalog close/reopen', async () => {
	const f = fixture(), current = photo(), legacy = photoArchiveFixture(2).photo;
	await f.repository.createCatalog(root()); await f.repository.publishPhotos(root().id, 0, [current, legacy]);
	assert.deepEqual(await f.repository.loadPhoto(root().id, current.id), current);
	assert.equal(serializePhotoDocumentV1OrV2(await f.repository.loadPhoto(root().id, legacy.id)), serializePhotoDocumentV1OrV2(legacy));
	assert.equal((await f.repository.readSnapshot(root().id))?.indexRevision, 1);
	assert.equal((await f.repository.readSummaryPage(root().id)).items.length, 2);
	await f.repository.close(); const reopened = f.create();
	assert.deepEqual(await reopened.loadPhoto(root().id, current.id), current);
	const old = new PhotoCatalogRepositoryV2({ indexedDB: f.indexedDB, databaseName: DATABASE, verifyOriginal: async () => undefined });
	await assert.rejects(old.loadPhoto(root().id, current.id)); await assert.rejects(old.savePhoto(current, 0));
	assert.deepEqual(await old.loadPhoto(root().id, legacy.id), legacy);
	await Promise.all([old.close(), reopened.close()]);
});

test('repair metadata saves retain all recipes, immutable originals, catalog counts and sticky schema3', async () => {
	const f = fixture(), current = photo(); await f.repository.createCatalog(root()); await f.repository.publishPhotos(root().id, 0, [current]);
	const saved = await f.repository.savePhoto({ ...current, rating: 5, metadata: { ...current.metadata, title: 'Needle' } }, 0);
	assert.equal(saved.revision, 1); assert.equal(saved.schemaVersion, 3); assert.deepEqual(saved.versions, current.versions);
	assert.deepEqual(saved.original, current.original); assert.equal((await f.repository.loadCatalog(root().id))?.revision, 1);
	assert.equal((await f.repository.readSnapshot(root().id))?.indexRevision, 2);
	const downgrade = { ...photoArchiveFixture().photo, schemaVersion: 2, revision: 1 };
	await assert.rejects(f.repository.savePhoto(downgrade, 1), /downgrad/iu);
	await assert.rejects(f.repository.savePhoto({ ...saved, original: { ...saved.original, name: 'Changed' } }, 1));
	await assert.rejects(f.repository.savePhoto({ ...saved, extractedMetadata: {} }, 1));
	await assert.rejects(f.repository.savePhoto({ ...current, rating: 1 }, 0), { code: 'PHOTO_REVISION_CONFLICT' });
	for (const rows of [await f.repository.readQueryPage(root().id, { query: { text: 'Needle' } }),
		await f.repository.readQueryPageV2(root().id, { query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Needle' } })]) {
		assert.equal(rows.items[0]?.photoRevision, 1); assert.equal(rows.items[0]?.rating, 5);
	}
	assert.deepEqual(await f.repository.loadPhoto(root().id, current.id), saved); await f.repository.close();
});

test('complete retained process3 resources require actual verification while repairs alone require no bodies', async () => {
	const f = fixture(); await f.repository.createCatalog(root());
	await assert.rejects(f.repository.publishPhotos(root().id, 0, [photo(1, true)]), /resource/iu);
	assert.equal(f.raw.recordCount(DATABASE, 'photos'), 0);
	await f.repository.publishPhotos(root().id, 0, [photo()]); await f.repository.close();
	let calls = 0; const current = photo(1, true), g = fixture(async value => { calls++; assert.deepEqual(value, current); });
	await g.repository.createCatalog(root()); await g.repository.publishPhotos(root().id, 0, [current]);
	assert.equal(calls, 1); await g.repository.savePhoto(current, 0); assert.equal(calls, 2); await g.repository.close();
});

test('candidate is detached and the verifier receiver is pinned before its borrowed wait', async () => {
	const raw = createInstrumentedIndexedDB(), entered = deferred<void>(), release = deferred<void>(); let calls = 0;
	const options = { indexedDB: raw as unknown as IDBFactory, databaseName: DATABASE, verifyOriginal: async () => undefined,
		async verifyResources(this: unknown) { assert.equal(this, options); calls++; entered.resolve(); await release.promise; } };
	const repository = new PhotoCatalogRepositoryCurrentV1(options); await repository.createCatalog(root());
	const current = JSON.parse(JSON.stringify(photo(1, true))) as { id: string; versions: unknown[]; metadata: { title: string } };
	const expected = structuredClone(current), work = repository.publishPhotos(root().id, 0, [current]);
	await entered.promise; current.versions.length = 0; current.metadata.title = 'Changed during wait';
	options.verifyResources = async () => assert.fail('Replaced resource callback'); release.resolve(); await work;
	assert.equal(calls, 1); assert.deepEqual(await repository.loadPhoto(root().id, expected.id), expected); await repository.close();
});

test('held verifier cancellation and Close join borrowed work without publishing any process3 rows', async () => {
	for (const closing of [false, true]) {
		const entered = deferred<void>(), release = deferred<void>(), cancel = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error('Opaque reflected'); }, getPrototypeOf() { traps++; throw Error('Opaque inspected'); } });
		const f = fixture(async (_value, signal) => { entered.resolve(); await release.promise; signal?.throwIfAborted(); });
		await f.repository.createCatalog(root()); let failure: unknown;
		const work = f.repository.publishPhotos(root().id, 0, [photo(1, true)], { signal: cancel.signal }).catch((error: unknown) => { failure = error; });
		await entered.promise; assert.equal(f.raw.stats.activeTransactions, 0);
		const closed = closing ? f.repository.close() : null; if (!closing) cancel.abort(reason);
		assert.equal(await remainsPending(work), true); if (closed) assert.equal(await remainsPending(closed), true);
		release.resolve(); await work; await closed; if (!closing) assert.equal(failure, reason);
		assert.equal(traps, 0); assert.equal(f.raw.recordCount(DATABASE, 'photos'), 0); await f.repository.close();
	}
});

test('closed physical inline keys refuse substitution of repaired Photo records', async () => {
	const f = fixture(), current = photo(); await f.repository.createCatalog(root());
	for (const row of [{ key: `catalog-1|${current.id}`, document: current },
		{ key: 'catalog-1|wrong', document: current }, { key: 'catalog-1|wrong' },
		{ key: 'catalog-1|wrong', document: undefined }, { key: 'catalog-1|wrong', document: current, future: true }]) {
		f.raw.seedRecord(DATABASE, 'photos', row, 'catalog-1|wrong'); await assert.rejects(f.repository.loadPhoto(root().id, 'wrong'));
	}
	await assert.rejects(f.repository.savePhoto(current, 0), /missing/iu); await f.repository.close();
});

test('all actual transaction publication failures roll back process3 documents and scalar projections together', async () => {
	for (const store of ['photos', 'summaries', 'memberships', 'catalogStates', 'catalogs', 'photoQueryRows', 'photoQueryRowsV2', 'photoQueryBuildStates', 'photoQueryBuildStatesV2']) {
		const f = fixture(); await f.repository.createCatalog(root());
		f.raw.failNextPutForStore(store, new DOMException('Refused', 'QuotaExceededError'));
		await assert.rejects(f.repository.publishPhotos(root().id, 0, [photo()]));
		for (const owned of ['photos', 'summaries', 'memberships', 'photoQueryRows', 'photoQueryRowsV2']) assert.equal(f.raw.recordCount(DATABASE, owned), 0, store);
		assert.equal((await f.repository.loadCatalog(root().id))?.photoCount, 0); await f.repository.close();
	}
});

test('native-code completion ACK survives late cancellation and Close joins its held delivery', async () => {
	const f = fixture(), current = photo(); await f.repository.createCatalog(root());
	const database = await openPhotoCatalogDatabaseV1(f.indexedDB, DATABASE, () => undefined), transaction = database.transaction.bind(database);
	const entered = deferred<void>(), release = deferred<void>(), cancel = new AbortController(); let armed = true;
	database.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const tx = transaction(names, mode);
		if (armed && mode === 'readwrite') { armed = false; let complete: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(tx, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { complete = value; },
				get() { return (event: Event) => { entered.resolve(); cancel.abort(); void release.promise.then(() => complete?.call(tx, event)); }; } }); }
		return tx;
	}) as IDBDatabase['transaction'];
	const work = f.repository.publishPhotos(root().id, 0, [current], { signal: cancel.signal });
	await entered.promise; const closed = f.repository.close(); assert.equal(await remainsPending(closed), true);
	release.resolve(); assert.equal((await work).photoCount, 1); await closed;
	assert.equal(f.raw.recordCount(DATABASE, 'photos'), 1); database.transaction = transaction; database.close();
});

test('current rebuild and culling point audit use genuine repaired documents with unchanged query profiles', async () => {
	const f = fixture(), current = photo(); await f.repository.createCatalog(root());
	const populated = { ...root(), revision: 1, photoCount: 1 };
	f.raw.seedRecord(DATABASE, 'catalogs', populated);
	f.raw.seedRecord(DATABASE, 'catalogStates', { id: populated.id, schemaFamily: 'lightscaper', schemaVersion: 1, rootRevision: 1, indexRevision: 1, photoCount: 1 });
	f.raw.seedRecord(DATABASE, 'photos', { key: `catalog-1|${current.id}`, document: current });
	for (const [store, schemaVersion] of [['photoQueryBuildStates', 1], ['photoQueryBuildStatesV2', 2]] as const)
		f.raw.seedRecord(DATABASE, store, { id: populated.id, schemaVersion, ready: false, afterKey: null, indexedCount: 0 });
	assert.equal((await f.repository.rebuildQueryIndexPage(populated.id)).ready, true);
	assert.equal((await f.repository.rebuildQueryIndexPageV2(populated.id)).ready, true);
	assert.deepEqual((await f.repository.readQueryPage(populated.id)).items, (await f.repository.readQueryPageV2(populated.id)).items);
	await f.repository.savePhoto(current, 0);
	const page = await f.repository.readCullingDestinationPage(populated.id,
		{ kind: 'query', query: normalizePhotoCatalogQueryV1(), collapsed: false }, { photoId: current.id });
	assert.equal(page?.rows[0]?.id, current.id);
	const metadata = await f.repository.readCullingDestinationPage(populated.id, { kind: 'query',
		query: normalizePhotoCatalogQueryV2(), collapsed: false }, { photoId: current.id });
	assert.deepEqual(metadata?.rows, page?.rows); await f.repository.close();
});

test('resource verifier opaque failure and pre-aborted demand publish no partial repaired rows', async () => {
	let traps = 0, calls = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('Opaque reflected'); }, getPrototypeOf() { traps++; throw Error('Opaque inspected'); } });
	const f = fixture(async () => { calls++; throw reason; }); await f.repository.createCatalog(root());
	await f.repository.publishPhotos(root().id, 0, [photo(1, true)]).then(() => assert.fail('Expected resource refusal'),
		(error: unknown) => { assert.equal(Object.is(error, reason), true); });
	const cancel = new AbortController(); cancel.abort(reason);
	await f.repository.publishPhotos(root().id, 0, [photo(1, true)], { signal: cancel.signal }).then(() => assert.fail('Expected aborted refusal'),
		(error: unknown) => { assert.equal(Object.is(error, reason), true); });
	assert.equal(calls, 1); assert.equal(traps, 0); assert.equal(f.raw.recordCount(DATABASE, 'photos'), 0); await f.repository.close();
});

test('current resource walk retains disabled LUTs and unbound or unused brushes from inactive, redo and snapshots', () => {
	const collector = createPhotoResourceReachabilityCurrentV1(), value = photo(1, true), before = JSON.stringify(value);
	collector.addPhoto(value); collector.addPhoto(value); const result = collector.finish();
	assert.deepEqual(result.luts.map(reference => reference.sha256), [1, 2, 3].map(digest));
	assert.deepEqual(result.brushes.map(reference => reference.sha256), [101, 102, 103, 201, 202, 203].map(digest));
	assert.equal(JSON.stringify(value), before); assert.equal(collector.finish(), result);
	for (const references of [result.luts, result.brushes]) {
		assert.equal(Object.isFrozen(references), true); assert.equal(references.every(Object.isFrozen), true);
	}
	assert.throws(() => collector.addPhoto(photoArchiveFixture().photo), /sealed/iu);
});

test('conflicting process3 resource packets cannot partially change a complete admitted ledger', () => {
	const collector = createPhotoResourceReachabilityCurrentV1(); collector.addPhoto(photo(1, true));
	// New redo/snapshot identities precede the conflict, so a partial merge is observable.
	const candidate = photo(2, true, 10), bad = develop(3, true);
	const conflicting = { ...candidate, versions: candidate.versions.map((version, index) => index !== 1 ? version : {
		...version, develop: { ...bad, effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false,
			params: { lut: { storageKey: `lut-sha256:${digest(3)}`, sha256: digest(3), byteLength: 73,
				size: 3, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }] } }) };
	assert.throws(() => collector.addPhoto(conflicting), /conflict/iu);
	assert.deepEqual(collector.finish().luts.map(reference => reference.sha256), [1, 2, 3].map(digest));
	assert.equal(collector.finish().brushes.length, 6);
});

test('current resource collection refuses schema2 smuggling and honors reentrant sealing without getters', () => {
	const collector = createPhotoResourceReachabilityCurrentV1(); let getters = 0;
	const accessor = Object.defineProperty(photo(), 'versions', { enumerable: true, get() { getters++; return []; } });
	for (const value of [accessor, { ...photo(), schemaVersion: 2 }, { ...photo(), schemaVersion: 4 }, { ...photo(), extra: true }])
		assert.throws(() => collector.addPhoto(value));
	assert.equal(getters, 0); assert.deepEqual(collector.finish(), { luts: [], brushes: [] });
	const second = createPhotoResourceReachabilityCurrentV1(); let sealed: ReturnType<typeof second.finish> | undefined;
	const input = new Proxy(photo(1, true), { ownKeys(target) { sealed = second.finish(); return Reflect.ownKeys(target); } });
	assert.throws(() => second.addPhoto(input), /sealed/iu); assert.equal(second.finish(), sealed);
	assert.deepEqual(sealed, { luts: [], brushes: [] });
});

test('current resource collection enforces the existing combined LUT and brush reference capacity atomically', () => {
	const collector = createPhotoResourceReachabilityCurrentV1(), maximum = PHOTO_CUBE_LUT_CLOSURE_LIMITS_V1.maximumReferences;
	const original = photoArchiveFixture().photo, master = original.versions[0]!;
	const packet = (index: number) => ({ ...original, schemaVersion: 3,
		versions: [{ ...master, develop: develop(index * 1000, true) }] });
	const admitted = Math.floor(maximum / 3);
	for (let index = 1; index <= admitted; index++) collector.addPhoto(packet(index));
	collector.addPhoto(packet(1)); assert.throws(() => collector.addPhoto(packet(admitted + 1)), /capacity/iu);
	const result = collector.finish(); assert.equal(result.luts.length + result.brushes.length, admitted * 3);
});
