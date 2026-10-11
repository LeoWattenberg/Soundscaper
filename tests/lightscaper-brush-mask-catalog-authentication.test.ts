/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
const CREATED = '2026-10-11T00:00:00.000Z';
const root = () => ({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog-1',
	name: 'Brush', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
function body() {
	const bytes = new Uint8Array(20); bytes.set(new TextEncoder().encode('SCMASK01'));
	new DataView(bytes.buffer).setUint32(8, 4, true); new DataView(bytes.buffer).setUint32(12, 1, true);
	bytes.set([0, 64, 128, 255], 16); const sha256 = createHash('sha256').update(bytes).digest('hex');
	return { bytes, reference: { storageKey: `brush-mask-v1:4:1:${sha256}`, sha256, width: 4, height: 1, byteLength: 20 } };
}
function photo() {
	const original = photoArchiveFixture().photo, source = body().reference.storageKey;
	const develop = { ...defaultImageDevelopStateV1(), processVersion: 2,
		masks: [{ schemaVersion: 1, id: 'brush', kind: 'mask', inputs: [{ name: 'Brush', kind: 'raster', sourceRef: source }],
			nodes: [{ id: 'alpha', kind: 'raster', inputName: 'Brush', channel: 'alpha' }], outputNodeId: 'alpha' }] };
	let workspace = createPhotoDevelopWorkspaceV2(original.versions[0]!.develop, { label: 'Original', createdAt: CREATED });
	workspace = commitPhotoDevelopWorkspaceV2(workspace, develop, { label: 'Brush', createdAt: CREATED });
	workspace = { ...workspace, snapshots: [{ id: 'snapshot', name: 'Brush', createdAt: CREATED, develop: workspace.entries[1]!.develop }] };
	workspace = selectPhotoDevelopHistoryV2(workspace, 0);
	return normalizePhotoDocumentV2({ ...original, schemaVersion: 2, versions: [{ ...original.versions[0], workspace }] });
}

function lockManager(): LockManager {
	const active = new Set<string>();
	return { async request(name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) {
		if (active.has(name)) return run(null);
		active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
}

test('actual catalog refuses brush-only retained redo and snapshot resources without a selected verifier', async () => {
	const raw = createInstrumentedIndexedDB(), databaseName = `lightscaper-brush-catalog-${crypto.randomUUID()}`;
	const repository = new PhotoCatalogRepositoryV2({ indexedDB: raw as unknown as IDBFactory, databaseName, verifyOriginal: async () => undefined });
	try {
		await repository.createCatalog(root());
		await assert.rejects(repository.publishPhotos('catalog-1', 0, [photo()]), /resource|verification/iu);
		assert.equal(await repository.loadPhoto('catalog-1', 'photo-1'), null);
		assert.equal((await repository.loadCatalog('catalog-1'))?.revision, 0);
		assert.equal(raw.recordCount(databaseName, 'photos'), 0);
	} finally { await repository.close(); }
});

test('actual catalog invokes selected brush verifier before publication and metadata CAS, leaving failed rows unchanged', async () => {
	const raw = createInstrumentedIndexedDB(); let calls = 0, refuse = true;
	const missing = new Error('Missing authenticated brush body');
	const repository = new PhotoCatalogRepositoryV2({ indexedDB: raw as unknown as IDBFactory,
		databaseName: `lightscaper-brush-catalog-${crypto.randomUUID()}`, verifyOriginal: async () => undefined,
		async verifyResources(value) { calls++; assert.deepEqual(value.versions, photo().versions); if (refuse) throw missing; } });
	try {
		await repository.createCatalog(root());
		await assert.rejects(repository.publishPhotos('catalog-1', 0, [photo()]), error => error === missing);
		assert.equal(calls, 1); refuse = false;
		await repository.publishPhotos('catalog-1', 0, [photo()]); const before = await repository.readSnapshot('catalog-1');
		refuse = true; await assert.rejects(repository.savePhoto({ ...photo(), rating: 5 }, 0), error => error === missing);
		assert.equal(calls, 3); assert.deepEqual(await repository.loadPhoto('catalog-1', 'photo-1'), photo());
		assert.deepEqual(await repository.readSnapshot('catalog-1'), before);
	} finally { await repository.close(); }
});

test('selected media brush install, close/reopen and actual catalog verification authenticate immutable bodies', async () => {
	const raw = createInstrumentedIndexedDB(), indexedDB = raw as unknown as IDBFactory;
	const databaseName = `lightscaper-brush-media-${crypto.randomUUID()}`, options = { indexedDB, databaseName, preferOpfs: false, locks: null };
	let media = new PhotoMediaStoreV1(options); const input = body(), current = photo();
	let catalog: PhotoCatalogRepositoryV2 | undefined;
	try {
		await media.ready(); let resources = await media.getMaskRasterResources();
		await media.mediaRepository.writeAsset(current.original.storageKey, photoArchiveFixture().original);
		await resources.put(input.reference, input.bytes); await media.close();
		media = new PhotoMediaStoreV1(options); await media.ready(); resources = await media.getMaskRasterResources();
		assert.equal(await media.getMaskRasterResources(), resources);
		catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: `lightscaper-brush-catalog-${crypto.randomUUID()}`,
			verifyOriginal: media.verifyOriginal, verifyResources: resources.verifyPhoto });
		await catalog.createCatalog(root()); await catalog.publishPhotos('catalog-1', 0, [current]);
		const before = await catalog.readSnapshot('catalog-1');
		raw.seedRecord(databaseName, 'analysis', { key: input.reference.storageKey,
			value: { schemaVersion: 1, kind: 'photo-mask-raster-body', reference: input.reference, bytes: new Uint8Array(input.bytes.length) } });
		await assert.rejects(catalog.savePhoto({ ...current, rating: 5 }, 0), /brush|mask|header|digest|identity/iu);
		assert.deepEqual(await catalog.readSnapshot('catalog-1'), before);
		assert.deepEqual(await catalog.loadPhoto('catalog-1', 'photo-1'), current);
		assert.deepEqual(input.bytes, body().bytes); assert.equal(raw.recordCount(databaseName, 'mediaAssets'), 1);
	} finally { await catalog?.close(); await media.close(); }
});

test('held brush verification joins opaque cancellation and Close before any native publication', async () => {
	const raw = createInstrumentedIndexedDB(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	const repository = new PhotoCatalogRepositoryV2({ indexedDB: raw as unknown as IDBFactory,
		databaseName: `lightscaper-brush-catalog-${crypto.randomUUID()}`, verifyOriginal: async () => undefined,
		async verifyResources(_photo, signal) { entered.resolve(); await release.promise; signal?.throwIfAborted(); } });
	let closing: Promise<void> | undefined;
	try {
		await repository.createCatalog(root());
		const work = repository.publishPhotos('catalog-1', 0, [photo()], { signal: stop.signal });
		const result = work.then(() => ({ ok: true, reason: undefined as unknown }), (failure: unknown) => ({ ok: false, reason: failure }));
		await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true);
		stop.abort(reason); closing = repository.close(); assert.equal(await remainsPending(closing), true);
		release.resolve(); const outcome = await result;
		assert.equal(outcome.ok, false); assert.equal(Object.is(outcome.reason, reason), true); await closing;
	} finally { release.resolve(); await (closing ?? repository.close()); }
});

test('resource-free legacy catalog writes retain their no-resource-IO path', async () => {
	const raw = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV2({ indexedDB: raw as unknown as IDBFactory,
		databaseName: `lightscaper-brush-catalog-${crypto.randomUUID()}`, verifyOriginal: async () => undefined,
		verifyResources: async () => assert.fail('Resource-free photo acquired a body verifier') });
	try {
		const original = photoArchiveFixture().photo; await repository.createCatalog(root());
		await repository.publishPhotos('catalog-1', 0, [original]);
		const saved = await repository.savePhoto({ ...original, rating: 3 }, 0);
		assert.deepEqual(saved.original, original.original); assert.deepEqual(saved.versions, original.versions);
	} finally { await repository.close(); }
});

test('actual runtime3 binds brush authentication to its selected media before Session metadata and export verification', async () => {
	const raw = createInstrumentedIndexedDB(), indexedDB = raw as unknown as IDBFactory;
	const session = await createPhotoLibrarySessionV3({ name: 'Brush', indexedDB, locks: lockManager() });
	const media = new PhotoMediaStoreV1({ indexedDB, locks: null, preferOpfs: false });
	let catalog: PhotoCatalogRepositoryV2 | undefined;
	try {
		assert.ok(session.exportJournal); const journal = await session.exportJournal.open();
		const current = normalizePhotoDocumentV2({ ...photo(), catalogId: journal.catalogId }), input = body();
		const resources = await media.getMaskRasterResources(); await resources.put(input.reference, input.bytes);
		await media.mediaRepository.writeAsset(current.original.storageKey, photoArchiveFixture().original);
		catalog = new PhotoCatalogRepositoryV2({ indexedDB, verifyOriginal: media.verifyOriginal, verifyResources: resources.verifyPhoto });
		const selected = await catalog.loadCatalog(journal.catalogId); assert.ok(selected);
		await catalog.publishPhotos(journal.catalogId, selected.revision, [current]);
		await session.setRating(current.id, 3); const before = await catalog.loadPhoto(journal.catalogId, current.id); assert.ok(before);
		const request = { catalogId: journal.catalogId, photoId: current.id, versionId: current.activeVersionId, expectedRevision: before.revision };
		await journal.verifyResources(request);
		raw.seedRecord('lightscaper-photo-media-v2', 'analysis', { key: input.reference.storageKey,
			value: { schemaVersion: 1, kind: 'photo-mask-raster-body', reference: input.reference, bytes: new Uint8Array(input.bytes.length) } });
		await assert.rejects(session.setRating(current.id, 5), /brush|mask|header|digest|identity/iu);
		await assert.rejects(journal.verifyResources(request), /brush|mask|header|digest|identity/iu);
		assert.deepEqual(await catalog.loadPhoto(journal.catalogId, current.id), before);
	} finally { await catalog?.close(); await session.close(); await media.close(); }
});
