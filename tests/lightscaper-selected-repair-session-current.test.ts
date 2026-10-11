/* SPDX-License-Identifier: AGPL-3.0-only */

// Actual selected/native-code owners; IDB/Web Locks are controlled Node ports.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const TIME = '2026-10-11T00:00:00.000Z';
function observe<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function fixture() {
	const native = mediaRestoreFixture(), locks = new MemoryLockManager() as unknown as LockManager;
	const options = { name: 'Current repairs', indexedDB: native.factory, locks };
	const initialize = await createPhotoLibrarySessionV3(options);
	try { await initialize.readPage(); } finally { await initialize.close(); }
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks });
	let selection: Awaited<ReturnType<typeof readPhotoLibrarySessionLocationV2>>;
	try { await anchor.ready(); selection = await withPhotoLibraryInitializationLockV1(locks, authority => readPhotoLibrarySessionLocationV2({
		settings: anchor.settingsRepository, initializeDefault: async () => { throw Error('Actual default pointer must already exist.'); } }, authority.signal)); }
	finally { await anchor.close(); }
	const input = photoArchiveFixture(), legacy = { ...input.photo, catalogId: selection.location.catalogId }, original = input.original;
	const repair = replaceImageDevelopRepairSpotsV1(legacy.versions[0]!.develop, { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: false,
		target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 0.2, feather: 0, opacity: 1 }] });
	const photo = normalizePhotoDocumentCurrentV1({ ...legacy, schemaVersion: 3, versions: [{ ...legacy.versions[0], workspace: {
		schemaVersion: 3, kind: 'photo-develop-workspace', entries: [{ label: 'Original', createdAt: TIME, develop: legacy.versions[0]!.develop },
			{ label: 'Repair redo', createdAt: TIME, develop: repair }], cursor: 0,
			snapshots: [{ id: 'retained', name: 'Retained repair', createdAt: TIME, develop: repair }] } },
		{ ...legacy.versions[0], id: 'inactive', kind: 'virtual-copy', name: 'Inactive repair', develop: repair }] });
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, databaseName: selection.location.mediaDatabaseName, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: selection.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	const brush = await withPreparedBrushMaskResourceV1({ width: 2, height: 1, alpha: Uint8Array.of(0, 255) }, value => ({ reference: value.reference, bytes: value.bytes.slice() }));
	try {
		await media.ready(); await (await media.getMaskRasterResources()).put(brush.reference, brush.bytes);
		const metadata = await media.mediaRepository.writeAsset(photo.original.storageKey, original);
		await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'seed', [{ photoId: photo.id, sourceId: photo.original.id,
			assetId: metadata.sourceId, sha256: metadata.sha256, size: metadata.size }]);
		const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root); await catalog.publishPhotos(root.id, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.promote(photo.catalogId, 'seed', [photo.id]);
	} finally { await Promise.all([catalog.close(), media.close()]); }
	async function inspect() {
		const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, databaseName: selection.location.mediaDatabaseName, preferOpfs: false });
		const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: selection.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
		try { const row = await catalog.loadPhoto(photo.catalogId, photo.id), blob = await media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(blob);
			return { photo: row, bytes: new Uint8Array(await blob.arrayBuffer()), metadata: await media.mediaRepository.getAssetMetadata(photo.original.storageKey),
				roots: await media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId }) }; }
		finally { await Promise.all([catalog.close(), media.close()]); }
	}
	return { native, options, selection, photo, repair, brush, inspect };
}

test('selected Current runtime reads retained repair history and saves through its real cached owner', async () => {
	const f = await fixture(), before = await f.inspect(), session = await createPhotoLibrarySessionCurrentV1(f.options);
	try {
		assert.equal((await session.readPage()).totalCount, 1);
		const read = await session.develop.read({ schemaVersion: 3, photoId: f.photo.id });
		assert.equal(read.schemaVersion, 3); assert.equal(read.develop.processVersion, 1); assert.equal(read.history.entries.length, 2);
		assert.equal(read.snapshots[0]?.id, 'retained');
		const ack = await session.develop.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: 0,
			command: { type: 'select-develop-history', versionId: f.photo.activeVersionId, cursor: 1 } });
		assert.equal(ack.snapshot.revision, 1); assert.deepEqual(ack.snapshot.develop, f.repair); assert.deepEqual(ack.notices, []);
		await session.applyAttributes(f.photo.id, { rating: 4 });
		assert.equal((await session.readMetadata(f.photo.id)).revision, 2);
	} finally { await session.close(); }
	const after = await f.inspect(); assert.equal(after.photo?.schemaVersion, 3); assert.equal(after.photo?.rating, 4);
	assert.deepEqual(after.photo?.original, before.photo?.original); assert.deepEqual(after.bytes, before.bytes);
	assert.deepEqual(after.metadata, before.metadata); assert.deepEqual(after.roots, before.roots);
	const reopen = await createPhotoLibrarySessionCurrentV1(f.options);
	try { assert.deepEqual((await reopen.develop.read({ schemaVersion: 3, photoId: f.photo.id })).develop, f.repair); }
	finally { await reopen.close(); }
});

test('selected Current scalar metadata and membership receipts follow actual native saves without dropping repaired versions', async () => {
	const f = await fixture(), session = await createPhotoLibrarySessionCurrentV1(f.options);
	try {
		const metadata = await session.applyMetadata(f.photo.id, 0, { title: 'Original repaired' });
		assert.equal(metadata.revision, 1); assert.equal(metadata.metadata.title, 'Original repaired');
		const before = await session.readMemberships(f.photo.id); assert.equal(before.revision, 1);
		const ack = await session.applyMemberships(f.photo.id, 1, { folderId: null, keywordIds: [], collectionIds: [] });
		assert.equal(ack.snapshot.photoId, f.photo.id); assert.equal(ack.snapshot.revision, 1, 'An equal patch must remain a native no-op.');
	} finally { await session.close(); }
	const stored = (await f.inspect()).photo; assert.ok(stored); assert.equal(stored.schemaVersion, 3);
	assert.deepEqual(stored.versions, f.photo.versions); assert.equal(stored.metadata.title, 'Original repaired');
});

test('legacy selected runtime remains a strict Photo1/2 frontdoor against the same native repaired row', async () => {
	const f = await fixture(), before = await f.inspect(), legacy = await createPhotoLibrarySessionV3(f.options);
	try { assert.equal((await legacy.readPage()).totalCount, 1);
		await assert.rejects(legacy.develop.read({ schemaVersion: 2, photoId: f.photo.id }));
		await assert.rejects(legacy.applyAttributes(f.photo.id, { rating: 5 }));
	} finally { await legacy.close(); }
	assert.deepEqual(await f.inspect(), before);
});

test('Current runtime captures cancellation before reflecting hostile caller options', async () => {
	const cancel = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); cancel.abort(reason.proxy); let reflected = 0;
	const options = new Proxy({ signal: cancel.signal }, { ownKeys() { reflected++; throw Error('Unwanted caller reflection'); } });
	const result = await observe(createPhotoLibrarySessionCurrentV1(options as never));
	assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, reason.proxy); assert.equal(reflected, 0);
});

test('selected Current Close retires accepting operations and returns one cached native join', async () => {
	const f = await fixture(), session = await createPhotoLibrarySessionCurrentV1(f.options), entered = deferred<void>(), release = deferred<void>();
	const work = observe(session.maskRasterSource.withBytes(f.brush.reference, async bytes => {
		assert.deepEqual(bytes, f.brush.bytes); entered.resolve(); await release.promise;
	}));
	try {
		const reached = await Promise.race([entered.promise.then(() => true), work.then(() => false)]); assert.equal(reached, true);
		const close = session.close(); assert.equal(session.close(), close);
		assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(close), true);
		release.resolve(); await work; await close; await assert.rejects(session.readPage());
	} finally { release.resolve(); await work; await session.close(); }
});
