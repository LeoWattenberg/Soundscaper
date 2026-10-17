/* SPDX-License-Identifier: AGPL-3.0-only */

// Current selected Session brush bodies use real storage and operation owners.
// Node storage/locking are explicit fixtures; no browser decoder/worker claim.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { PhotoLibrarySessionPortV2 } from '../src/common/editor/photo-library-session-port-v2.ts';
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
function selectedSource(session: PhotoLibrarySessionPortV2): Readonly<MaskRasterSourcePortV1> {
	const value: unknown = Reflect.get(session, 'maskRasterSource');
	assert.ok(isSource(value), 'Current selected Session must supply its own joined brush source.'); return value;
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
	const options = { name: 'Selected brush source', indexedDB: native.factory, locks }, body = await brush();
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
		await (await setupMedia.getMaskRasterResources()).put(body.reference, body.bytes);
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
	async function installSelected() {
		const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false });
		try { await (await media.getMaskRasterResources()).put(body.reference, body.bytes); } finally { await media.close(); }
	}
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
	return { native, options, body, selected, installSelected, original, rows, donor, donorBefore };
}

test('actual default runtime3 selected source survives reopen without changing Photo, original or custody', async t => {
	const f = await fixture(), before = await f.original(), session = await createPhotoLibrarySessionV3(f.options);
	t.after(() => session.close()); let borrowed: Uint8Array<ArrayBuffer> | undefined;
	assert.deepEqual(await selectedSource(session).withBytes(f.body.reference, bytes => { borrowed = bytes; return [...bytes]; }), [...f.body.bytes]);
	assert.ok(borrowed?.every(value => value === 0)); await session.close();
	const reopened = await createPhotoLibrarySessionV3(f.options); t.after(() => reopened.close());
	assert.deepEqual(await selectedSource(reopened).withBytes(f.body.reference, bytes => [...bytes]), [...f.body.bytes]);
	await reopened.close(); assert.deepEqual(await f.original(), before); assert.deepEqual(f.rows(f.donor.location), f.donorBefore);
});

test('actual V5 committed allocation never borrows the donor default brush body and preserves both original ledgers', async t => {
	const f = await fixture(true), before = await f.original(), empty = await createPhotoLibrarySessionV3(f.options);
	t.after(() => empty.close()); await assert.rejects(selectedSource(empty).withBytes(f.body.reference, () => assert.fail('Wrong namespace body')), /missing/iu);
	await empty.close(); await f.installSelected(); const installed = f.rows(f.selected.location);
	const session = await createPhotoLibrarySessionV3(f.options); t.after(() => session.close());
	assert.deepEqual(await selectedSource(session).withBytes(f.body.reference, bytes => [...bytes]), [...f.body.bytes]);
	await session.close(); const reopened = await createPhotoLibrarySessionV3(f.options); t.after(() => reopened.close());
	assert.deepEqual(await selectedSource(reopened).withBytes(f.body.reference, bytes => [...bytes]), [...f.body.bytes]);
	await reopened.close(); assert.deepEqual(await f.original(), before); assert.deepEqual(f.rows(f.selected.location), installed);
	assert.deepEqual(f.rows(f.donor.location), f.donorBefore);
});

test('selected brush borrower joins first opaque native caller reason and Session Close before releasing bytes', async t => {
	const f = await fixture(), before = await f.original(), session = await createPhotoLibrarySessionV3(f.options);
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), joining: { work?: Promise<unknown> } = {};
	t.after(async () => { release.resolve(); await joining.work; await session.close(); });
	const source = selectedSource(session), opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason: unknown = opaque.proxy;
	let borrowed: Uint8Array<ArrayBuffer> | undefined;
	const work = source.withBytes(f.body.reference, async bytes => { borrowed = bytes; entered.resolve(); await release.promise; }, { signal: stop.signal });
	const result = outcome(work); joining.work = result;
	await Promise.race([entered.promise, work]); stop.abort(reason); const closing = session.close();
	assert.equal(session.close(), closing); assert.equal(await remainsPending(closing), true); assert.equal(await remainsPending(work), true);
	await assert.rejects(source.withBytes(f.body.reference, () => assert.fail('Closed borrow admitted')), /closed/iu);
	assert.ok(borrowed); assert.deepEqual([...borrowed], [...f.body.bytes]);
	release.resolve(); const settled = await result; assert.equal(settled.ok, false);
	if (!settled.ok) assert.equal(Object.is(settled.error, reason), true);
	await closing; assert.ok(borrowed.every(value => value === 0)); assert.deepEqual(await f.original(), before);
});

test('selected Session snapshots canonical reference in the call and rejects accessors before actual analysis reads', async t => {
	const f = await fixture(), session = await createPhotoLibrarySessionV3(f.options); t.after(() => session.close());
	const source = selectedSource(session), mutable = { ...f.body.reference };
	const work = source.withBytes(mutable, bytes => [...bytes]); mutable.storageKey = 'brush-mask-v2:future'; mutable.width = 99;
	assert.deepEqual(await work, [...f.body.bytes]);
	let getters = 0, reads = 0;
	f.native.raw(f.selected.location.mediaDatabaseName).onNextGetForStore('analysis', () => { reads++; });
	const getter = Object.defineProperty({ ...f.body.reference }, 'storageKey', { enumerable: true, get() { getters++; return f.body.reference.storageKey; } });
	for (const invalid of [getter, { ...f.body.reference, future: true }, { ...f.body.reference, sha256: 'f'.repeat(64) }]) {
		await assert.rejects(source.withBytes(invalid, () => assert.fail('Invalid reference consumed')));
	}
	assert.equal(getters, 0); assert.equal(reads, 0);
	assert.deepEqual(await source.withBytes(f.body.reference, bytes => [...bytes]), [...f.body.bytes]); assert.equal(reads, 1);
});

test('selected source preserves opaque consumer failure, wipes its true borrow and does not mutate durable body', async t => {
	const f = await fixture(), session = await createPhotoLibrarySessionV3(f.options); t.after(() => session.close());
	const source = selectedSource(session), before = f.rows(f.selected.location), revoked = Proxy.revocable({}, {}); revoked.revoke();
	let borrowed: Uint8Array<ArrayBuffer> | undefined;
	const result = await outcome(source.withBytes(f.body.reference, bytes => { borrowed = bytes; throw revoked.proxy; }));
	assert.equal(result.ok, false); if (!result.ok) assert.equal(Object.is(result.error, revoked.proxy), true);
	assert.ok(borrowed?.every(value => value === 0)); assert.deepEqual(f.rows(f.selected.location), before);
});

test('actual Session pins the selected loader and its real receiver before held readiness or caller reference reflection', async t => {
	const f = await fixture(), before = f.rows(f.selected.location), entered = deferred<void>(), release = deferred<void>();
	const media = new PhotoMediaStoreV1({ indexedDB: f.native.factory, locks: f.options.locks,
		databaseName: f.selected.location.mediaDatabaseName, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: f.native.factory,
		databaseName: f.selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	const lifecycle: { session?: PhotoLibrarySessionV2; work?: Promise<unknown> } = {};
	t.after(async () => { release.resolve(); await lifecycle.work; if (lifecycle.session) await lifecycle.session.close(); else await closeAll([catalog, media]); });
	const resources = await media.getMaskRasterResources();
	let initializations = 0, loaderCalls = 0, replacements = 0, referenceTraps = 0, reads = 0;
	const ports = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, exclusive: createPhotoLibrarySelectedExclusiveV2(media.settingsRepository, f.selected, f.options.locks),
		maskRasterResources: function (this: unknown) { assert.equal(this, ports); loaderCalls++; return Promise.resolve(resources); },
		initialize: async () => {
			initializations++; const root = await catalog.loadCatalog(f.selected.location.catalogId); assert.ok(root);
			entered.resolve(); await release.promise; return root;
		}, closeResources: () => closeAll([catalog, media]) };
	const session = new PhotoLibrarySessionV2(ports); lifecycle.session = session; const source = selectedSource(session);
	f.native.raw(f.selected.location.mediaDatabaseName).onNextGetForStore('analysis', () => { reads++; });
	const trap = () => { referenceTraps++; throw Error('Pre-aborted reference reflected.'); };
	const hostile = new Proxy(f.body.reference, { ownKeys: trap, getOwnPropertyDescriptor: trap, get: trap, getPrototypeOf: trap });
	const stopped = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke(); stopped.abort(revoked.proxy);
	const cancelled = await outcome(source.withBytes(hostile, () => assert.fail('Pre-aborted body consumed'), { signal: stopped.signal }));
	assert.equal(cancelled.ok, false); if (!cancelled.ok) assert.equal(Object.is(cancelled.error, revoked.proxy), true);
	assert.equal(referenceTraps, 0); assert.equal(initializations, 0); assert.equal(loaderCalls, 0); assert.equal(reads, 0);
	let borrowed: Uint8Array<ArrayBuffer> | undefined;
	const work = source.withBytes(f.body.reference, bytes => { borrowed = bytes; return [...bytes]; }), result = outcome(work); lifecycle.work = result;
	try {
		await Promise.race([entered.promise, result.then(value => { if (!value.ok) throw value.error; throw Error('Readiness was not held.'); })]);
		assert.equal(await remainsPending(work), true); assert.equal(loaderCalls, 0); assert.equal(reads, 0);
		ports.maskRasterResources = async () => { replacements++; throw Error('Replacement selected loader called.'); };
	} finally { release.resolve(); await result; }
	assert.deepEqual(await work, [...f.body.bytes]); assert.ok(borrowed?.every(value => value === 0));
	assert.equal(initializations, 1); assert.equal(loaderCalls, 1); assert.equal(replacements, 0); assert.equal(reads, 1);
	await session.close(); assert.deepEqual(f.rows(f.selected.location), before);
});
