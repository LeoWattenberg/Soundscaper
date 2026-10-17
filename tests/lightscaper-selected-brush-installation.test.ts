/* SPDX-License-Identifier: AGPL-3.0-only */

// Selected immutable brush installation uses real Session/storage owners.
// Node storage/locking are explicit fixtures; no browser decoder/worker claim.
import assert from 'node:assert/strict';
import test, { after, type TestContext } from 'node:test';
import { withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { PhotoLibraryDevelopPortV2 } from '../src/common/editor/photo-library-develop-port-v2.ts';
import { capturePhotoLibraryDevelopPortV2 as captureCommand } from '../src/common/editor/controller/shared/photo-library-develop-command-v2.ts';
import { capturePhotoLibraryDevelopPortV2 as captureUi } from '../src/common/editor/ui/lightscaper/photo-library-workflow-develop.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoMediaMaskRasterResourcesV1 } from '../src/lightscaper/storage/photo-media-mask-raster-resources-v1.ts';
import type { PhotoCatalogImportExclusiveV1 } from '../src/lightscaper/import/catalog-write-lock-v1.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PhotoLibrarySessionV2 } from '../src/lightscaper/controller/photo-library-session-v2.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { createPhotoLibrarySelectedExclusiveV2 } from '../src/lightscaper/storage/photo-library-selected-exclusive-v2.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture, mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const MEDIA_STORES = ['mediaAssets', 'catalogOriginalRoots', 'analysis', 'videoDerivatives', 'videoDerivativeCacheEntries'] as const;
function outcome<Value>(operation: Promise<Value>) {
	return operation.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
function isSource(value: unknown): value is Readonly<MaskRasterSourcePortV1> {
	if (typeof value !== 'object' || value === null) return false;
	const own = Object.getOwnPropertyDescriptor(value, 'withBytes');
	return !!own && Object.hasOwn(own, 'value') && typeof own.value === 'function';
}
interface InstallAck {
	readonly schemaVersion: 1; readonly catalogId: string; readonly reference: Readonly<BrushMaskResourceReferenceV1>;
	readonly created: boolean; readonly notices: readonly 'cleanup-failed'[];
}
interface Installer {
	readonly schemaVersion: 1; readonly source: Readonly<MaskRasterSourcePortV1>;
	install(reference: unknown, bytes: unknown, options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<InstallAck>>;
}
function installer(port: Readonly<PhotoLibraryDevelopPortV2>): Readonly<Installer> {
	const value: unknown = Reflect.get(port, 'maskRasters');
	assert.ok(value && typeof value === 'object', 'Actual selected Develop must supply its immutable brush installer.');
	const method = Object.getOwnPropertyDescriptor(value, 'install'), source = Object.getOwnPropertyDescriptor(value, 'source');
	assert.ok(method && Object.hasOwn(method, 'value') && typeof method.value === 'function');
	assert.ok(source && Object.hasOwn(source, 'value') && isSource(source.value));
	assert.equal(Reflect.get(value, 'schemaVersion'), 1); return value as Readonly<Installer>;
}
async function brush() {
	return withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, prepared =>
		({ reference: prepared.reference, bytes: prepared.bytes.slice() }));
}
async function closeAll(owners: readonly Readonly<{ close(): Promise<void> }>[]) {
	const results = await Promise.allSettled(owners.map(owner => owner.close()));
	const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (errors.length === 1) throw errors[0];
	if (errors.length) throw new AggregateError(errors, 'Selected source fixture cleanup failed.');
}
async function fixture(restored = false) {
	const native = mediaRestoreFixture(), locks = new MemoryLockManager() as unknown as LockManager;
	const options = { name: 'Selected brush installation', indexedDB: native.factory, locks }, body = await brush();
	const initialize = await createPhotoLibrarySessionV3(options);
	try { assert.equal((await initialize.readPage()).totalCount, 0); } finally { await initialize.close(); }
	async function selection() {
		const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks });
		try { return await withPhotoLibraryInitializationLockV1(locks, authority => readPhotoLibrarySessionLocationV2({
			settings: anchor.settingsRepository, initializeDefault: () => Promise.reject(Error('Existing location required.')) }, authority.signal)); }
		finally { await anchor.close(); }
	}
	const donor = await selection(), input = photoArchiveFixture();
	assert.equal(donor.pointer.schemaVersion, 1); assert.equal(donor.allocation, null);
	const setupMedia = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, databaseName: donor.location.mediaDatabaseName, preferOpfs: false });
	const setupCatalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: donor.location.catalogDatabaseName,
		verifyOriginal: setupMedia.verifyOriginal });
	const donorPhoto = normalizePhotoDocumentV1OrV2({ ...input.photo, catalogId: donor.location.catalogId });
	try {
		if (restored) await (await setupMedia.getMaskRasterResources()).put(body.reference, body.bytes);
		const metadata = await setupMedia.mediaRepository.writeAsset(donorPhoto.original.storageKey, input.original);
		await setupMedia.mediaRepository.catalogOriginals.stage(donorPhoto.catalogId, 'fixture-import', [{ photoId: donorPhoto.id,
			assetId: metadata.sourceId, sourceId: donorPhoto.original.id, sha256: metadata.sha256, size: metadata.size }]);
		const root = await setupCatalog.loadCatalog(donorPhoto.catalogId); assert.ok(root);
		await setupCatalog.publishPhotos(root.id, root.revision, [donorPhoto]);
		await setupMedia.mediaRepository.catalogOriginals.promote(donorPhoto.catalogId, 'fixture-import', [donorPhoto.id]);
	} finally { await closeAll([setupCatalog, setupMedia]); }
	function rows(location: typeof donor.location) {
		return { catalog: PHOTO_CATALOG_STORES.map(store => native.raw(location.catalogDatabaseName).records(location.catalogDatabaseName, store)),
			media: MEDIA_STORES.map(store => native.raw(location.mediaDatabaseName).records(location.mediaDatabaseName, store)) };
	}
	const donorBefore = rows(donor.location);
	if (restored) {
		// The portable archive is neutral. Brush bodies are installed in selected media only after genuine restore selection.
		const archive = await exportPhotoCatalogArchiveV5(mediaRestoreRoot(1), [input], [], null, [], null, undefined);
		assert.ok(archive.blob); const runtime = createPhotoLibraryRestoreRuntimeV2(options);
		try { assert.equal((await runtime.restoreArchive(archive.blob)).photoCount, 1); } finally { await runtime.close(); }
	}
	const selected = await selection();
	assert.equal(selected.pointer.schemaVersion, restored ? 2 : 1);
	assert.equal(selected.allocation !== null, restored);
	if (restored) assert.notEqual(selected.location.mediaDatabaseName, donor.location.mediaDatabaseName);
	async function original() {
		const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false });
		const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		try {
			const photo = await catalog.loadPhoto(selected.location.catalogId, input.photo.id); assert.ok(photo);
			const file = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(file);
			const roots = await media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
			assert.equal(roots.roots.length, 1); assert.equal(roots.afterKey, null);
			return { photo, metadata: await media.mediaRepository.getAssetMetadata(photo.original.storageKey),
				bytes: new Uint8Array(await file.arrayBuffer()), roots,
				raw: native.raw(selected.location.mediaDatabaseName).records(selected.location.mediaDatabaseName, 'mediaAssets') };
		} finally { await closeAll([catalog, media]); }
	}
	return { native, options, body, selected, original, rows, donor, donorBefore };
}

interface Hooks { ready?: () => Promise<void>; afterPut?: () => Promise<void>; afterLease?: () => Promise<void>; onClose?: () => void; }
async function owned(t: TestContext, f: Awaited<ReturnType<typeof fixture>>, hooks: Hooks = {}) {
	const life: { session?: PhotoLibrarySessionV2; media?: PhotoMediaStoreV1; catalog?: PhotoCatalogRepositoryV2; work?: Promise<unknown> } = {};
	t.after(async () => { await life.work; if (life.session) await life.session.close();
		else await closeAll([...(life.catalog ? [life.catalog] : []), ...(life.media ? [life.media] : [])]); });
	const media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks,
		databaseName: f.selected.location.mediaDatabaseName, preferOpfs: false }); life.media = media;
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: f.native.factory,
		databaseName: f.selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal }); life.catalog = catalog;
	const resources = await media.getMaskRasterResources(), put = resources.put, inputs: Uint8Array<ArrayBuffer>[] = [];
	const calls = { ready: 0, loader: 0, put: 0, close: 0 };
	const facade: Readonly<PhotoMediaMaskRasterResourcesV1> = Object.freeze<PhotoMediaMaskRasterResourcesV1>({ source: resources.source,
		async put(reference, bytes, options) {
			assert.equal(this, facade); assert.ok(bytes instanceof Uint8Array); inputs.push(bytes as Uint8Array<ArrayBuffer>); calls.put++;
			const ack = await Reflect.apply(put, resources, [reference, bytes, options]); await hooks.afterPut?.(); return ack;
		}, verifyPhoto: (...args) => resources.verifyPhoto(...args), verifyPreset: (...args) => resources.verifyPreset(...args) });
	const exclusive = createPhotoLibrarySelectedExclusiveV2(media.settingsRepository, f.selected, f.options.locks);
	const admittedExclusive: PhotoCatalogImportExclusiveV1 = (catalogId, operation, signal) => exclusive(catalogId, async admitted => {
		const result = await operation(admitted); if (calls.put > 0) await hooks.afterLease?.(); return result;
	}, signal);
	const ports = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, exclusive: admittedExclusive,
		maskRasterResources: function (this: unknown) { assert.equal(this, ports); calls.loader++; return Promise.resolve(facade); },
		initialize: async () => { calls.ready++; const root = await catalog.loadCatalog(f.selected.location.catalogId); assert.ok(root); await hooks.ready?.(); return root; },
		closeResources: async () => { calls.close++; assert.ok(inputs.every(bytes => bytes.every(byte => byte === 0)), 'Private installer copies must wipe before selected resources close.');
			hooks.onClose?.(); await closeAll([catalog, media]); } };
	const session = new PhotoLibrarySessionV2(ports); life.session = session;
	return { session, ports, calls, inputs, life, resources };
}
function opaque() { const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy as unknown; }
function expectFailure(value: Awaited<ReturnType<typeof outcome>>, reason: unknown) {
	assert.equal(value.ok, false); if (!value.ok) assert.equal(Object.is(value.error, reason), true);
}

test('actual runtime3 installer precedes Photo CAS and survives reopen without changing original/custody', async t => {
	const f = await fixture(), before = await f.original(), rows = f.rows(f.selected.location), session = await createPhotoLibrarySessionV3(f.options);
	t.after(() => session.close()); const child = installer(session.develop);
	assert.equal(child.source, session.maskRasterSource);
	const ack = await child.install(f.body.reference, f.body.bytes);
	assert.deepEqual(ack, { schemaVersion: 1, catalogId: f.selected.location.catalogId, reference: f.body.reference, created: true, notices: [] });
	assert.equal((await child.install(f.body.reference.storageKey, f.body.bytes)).created, false);
	assert.deepEqual(await f.original(), before); assert.deepEqual(f.rows(f.selected.location).catalog, rows.catalog);
	assert.deepEqual(f.rows(f.selected.location).media.filter((_, index) => index !== 2), rows.media.filter((_, index) => index !== 2));
	const view = await session.develop.read({ schemaVersion: 2, photoId: before.photo.id });
	const develop = normalizeImageDevelopStateV1OrV2({ ...view.develop, processVersion: 2,
		masks: [{ schemaVersion: 1, id: 'brush', kind: 'mask', inputs: [{ name: 'Brush', kind: 'raster', sourceRef: ack.reference.storageKey }],
			nodes: [{ id: 'alpha', kind: 'raster', inputName: 'Brush', channel: 'alpha' }], outputNodeId: 'alpha' }] });
	const saved = await session.develop.apply({ schemaVersion: 2, photoId: view.photoId, expectedRevision: view.revision,
		command: { type: 'record-develop', versionId: view.versionId, develop, label: 'Brush', createdAt: '2026-10-11T00:00:00.000Z' } });
	assert.equal(saved.snapshot.revision, view.revision + 1); assert.equal(saved.snapshot.history.cursor, 1);
	await session.close(); const reopened = await createPhotoLibrarySessionV3(f.options); t.after(() => reopened.close());
	assert.deepEqual(await installer(reopened.develop).source.withBytes(ack.reference, bytes => [...bytes]), [...f.body.bytes]);
	assert.deepEqual((await reopened.develop.read({ schemaVersion: 2, photoId: view.photoId })).develop, develop); await reopened.close();
	const after = await f.original(); assert.deepEqual({ ...after, photo: before.photo }, before); assert.deepEqual(after.photo.original, before.photo.original);
});

test('genuine restored allocation installs only selected analysis even when default donor owns the same key', async t => {
	const f = await fixture(true), before = await f.original(), session = await createPhotoLibrarySessionV3(f.options); t.after(() => session.close());
	const child = installer(session.develop); await assert.rejects(child.source.withBytes(f.body.reference, () => assert.fail('Donor body borrowed')), /missing/iu);
	assert.equal((await child.install(f.body.reference, f.body.bytes)).created, true); await session.close();
	for (let index = 0; index < 2; index++) {
		const reopened = await createPhotoLibrarySessionV3(f.options); t.after(() => reopened.close());
		assert.deepEqual(await installer(reopened.develop).source.withBytes(f.body.reference, bytes => [...bytes]), [...f.body.bytes]); await reopened.close();
	}
	assert.deepEqual(f.rows(f.donor.location), f.donorBefore); assert.deepEqual(await f.original(), before);
});

test('both current Develop captures preserve child method/source receivers without borrowing callable metadata', async t => {
	const f = await fixture(), session = await createPhotoLibrarySessionV3(f.options); t.after(() => session.close());
	const real = installer(session.develop); let traps = 0, calls = 0;
	const child = { schemaVersion: 1 as const, source: real.source,
		install: new Proxy(function (this: unknown, ...args: Parameters<Installer['install']>) {
			assert.equal(this, child); calls++; return real.install(...args);
		}, { get() { traps++; throw Error('Callable metadata read.'); } }) };
	const owner = { ...session.develop, maskRasters: child }, command = installer(captureCommand(owner)), ui = installer(captureUi(owner));
	child.install = new Proxy(child.install, { apply() { throw Error('Replacement install used.'); } });
	child.source = { withBytes: () => Promise.reject(Error('Replacement source used.')) };
	assert.equal((await command.install(f.body.reference, f.body.bytes)).created, true);
	assert.equal((await ui.install(f.body.reference, f.body.bytes)).created, false);
	assert.deepEqual(await command.source.withBytes(f.body.reference, bytes => [...bytes]), [...f.body.bytes]);
	assert.deepEqual(await ui.source.withBytes(f.body.reference, bytes => [...bytes]), [...f.body.bytes]); assert.equal(calls, 2); assert.equal(traps, 0);
});

test('first writer snapshots body before held readiness and rejects second hostile input before reflection', async t => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(); t.after(() => { release.resolve(); });
	const f2 = await owned(t, f, { ready: async () => { entered.resolve(); await release.promise; } }), child = installer(f2.session.develop);
	const reference = { ...f.body.reference }, bytes = f.body.bytes.slice(), work = child.install(reference, bytes), result = outcome(work); f2.life.work = result;
	reference.storageKey = 'brush-mask-v2:future'; bytes.fill(0); await Promise.race([entered.promise, work]);
	let traps = 0; const trap = () => { traps++; throw Error('Second writer reflected.'); };
	const hostile = new Proxy({}, { ownKeys: trap, getOwnPropertyDescriptor: trap, get: trap, getPrototypeOf: trap });
	await assert.rejects(child.install(hostile, hostile), /pending/iu); assert.equal(traps, 0);
	f2.ports.maskRasterResources = async () => { throw Error('Replacement selected loader used.'); };
	assert.equal(f2.calls.loader, 0); release.resolve(); assert.equal((await work).created, true);
	assert.equal(f2.calls.loader, 1); assert.equal(f2.calls.put, 1); assert.ok(f2.inputs.every(input => input.every(byte => byte === 0)));
	assert.deepEqual(await child.source.withBytes(f.body.reference, value => [...value]), [...f.body.bytes]);
	assert.equal((await child.install(f.body.reference, f.body.bytes)).created, false);
});

test('native preabort and closed invalid inputs reject before readiness or selected body acquisition', async t => {
	const f = await fixture(), f2 = await owned(t, f), child = installer(f2.session.develop), stop = new AbortController(), reason = opaque(); stop.abort(reason);
	let traps = 0, getters = 0; const trap = () => { traps++; throw Error('Cancelled input reflected.'); };
	const hostile = new Proxy({}, { ownKeys: trap, getOwnPropertyDescriptor: trap, get: trap, getPrototypeOf: trap });
	expectFailure(await outcome(child.install(hostile, hostile, { signal: stop.signal })), reason); assert.equal(traps, 0);
	const accessor = Object.defineProperty({ ...f.body.reference }, 'storageKey', { enumerable: true, get() { getters++; return f.body.reference.storageKey; } });
	for (const invalid of [accessor, { ...f.body.reference, future: 1 }, { ...f.body.reference, sha256: 'f'.repeat(64) }, 'brush-mask-v2:future']) {
		await assert.rejects(child.install(invalid, f.body.bytes));
	}
	await assert.rejects(child.install(f.body.reference, new Uint8Array(new SharedArrayBuffer(f.body.bytes.length))));
	await assert.rejects(child.install(f.body.reference, new Uint8Array(f.body.bytes.buffer, 1)));
	assert.equal(getters, 0); assert.equal(f2.calls.ready, 0); assert.equal(f2.calls.loader, 0); assert.equal(f2.calls.put, 0);
	assert.equal((await child.install(f.body.reference, f.body.bytes)).created, true);
});

test('readiness failure releases captured body admission and permits retry only while the Session stays open', async t => {
	const f = await fixture(), reason = opaque(); let fail = true;
	const f2 = await owned(t, f, { ready: async () => { if (fail) { fail = false; throw reason; } } }), child = installer(f2.session.develop);
	expectFailure(await outcome(child.install(f.body.reference, f.body.bytes)), reason);
	assert.equal(f2.calls.loader, 0); assert.equal(f2.calls.put, 0); assert.equal((await child.install(f.body.reference, f.body.bytes)).created, true);
	assert.equal(f2.calls.ready, 2); await f2.session.close(); await assert.rejects(child.install(f.body.reference, f.body.bytes), /closed/iu);
});

test('Close during held readiness joins admission before cleanup and leaves original/analysis untouched', async t => {
	const f = await fixture(), before = f.rows(f.selected.location), entered = deferred<void>(), release = deferred<void>(); t.after(() => { release.resolve(); });
	const f2 = await owned(t, f, { ready: async () => { entered.resolve(); await release.promise; } }), child = installer(f2.session.develop), stop = new AbortController(), reason = opaque();
	const work = child.install(f.body.reference, f.body.bytes, { signal: stop.signal }), result = outcome(work); f2.life.work = result;
	await Promise.race([entered.promise, work]); stop.abort(reason); const closing = f2.session.close();
	assert.equal(f2.session.close(), closing); assert.equal(await remainsPending(closing), true); assert.equal(await remainsPending(work), true); assert.equal(f2.calls.close, 0);
	release.resolve(); expectFailure(await result, reason); await closing; assert.equal(f2.calls.put, 0); assert.equal(f2.calls.close, 1);
	assert.deepEqual(f.rows(f.selected.location), before);
});

test('reentrant Close during reference admission preserves first native reason and rejects before readiness', async t => {
	const f = await fixture(), f2 = await owned(t, f), child = installer(f2.session.develop), stop = new AbortController(), reason = opaque();
	const lifecycle: { closing?: Promise<void> } = {}; let traps = 0;
	const hostile = new Proxy(f.body.reference, { ownKeys() { traps++; stop.abort(reason); lifecycle.closing = f2.session.close(); throw Error('Admission error after first reason.'); } });
	expectFailure(await outcome(child.install(hostile, f.body.bytes, { signal: stop.signal })), reason); await lifecycle.closing;
	assert.equal(traps, 1); assert.equal(f2.calls.ready, 0); assert.equal(f2.calls.loader, 0); assert.equal(f2.calls.put, 0); assert.equal(f2.calls.close, 1);
});

test('true native body ACK remains installed while held delivery and selected lease cleanup join Close', async t => {
	const f = await fixture(), before = await f.original(), entered = deferred<void>(), release = deferred<void>(); t.after(() => { release.resolve(); });
	const f2 = await owned(t, f, { afterPut: async () => { entered.resolve(); await release.promise; } }), child = installer(f2.session.develop), stop = new AbortController(), reason = opaque();
	const work = child.install(f.body.reference, f.body.bytes, { signal: stop.signal }), result = outcome(work); f2.life.work = result;
	await Promise.race([entered.promise, work]);
	assert.equal(f.native.raw(f.selected.location.mediaDatabaseName).recordCount(f.selected.location.mediaDatabaseName, 'analysis'), 1);
	stop.abort(reason); const closing = f2.session.close(); assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
	assert.equal(f2.calls.close, 0); assert.ok(f2.inputs[0]?.some(byte => byte !== 0)); release.resolve();
	const ack = await work; assert.equal(ack.created, true); assert.deepEqual(ack.reference, f.body.reference); await closing;
	assert.ok(f2.inputs[0]?.every(byte => byte === 0)); assert.deepEqual(await f.original(), before);
	const reopened = await createPhotoLibrarySessionV3(f.options); t.after(() => reopened.close());
	assert.deepEqual(await installer(reopened.develop).source.withBytes(f.body.reference, bytes => [...bytes]), [...f.body.bytes]);
});

test('distinct opaque selected lease cleanup after committed body retains ACK and reports one cleanup notice', async t => {
	const f = await fixture(), reason = opaque(), f2 = await owned(t, f, { afterLease: async () => { throw reason; } }), child = installer(f2.session.develop);
	const ack = await child.install(f.body.reference, f.body.bytes);
	assert.deepEqual(ack, { schemaVersion: 1, catalogId: f.selected.location.catalogId, reference: f.body.reference, created: true, notices: ['cleanup-failed'] });
	assert.ok(f2.inputs.every(input => input.every(byte => byte === 0)));
	assert.deepEqual(await child.source.withBytes(f.body.reference, bytes => [...bytes]), [...f.body.bytes]);
});
