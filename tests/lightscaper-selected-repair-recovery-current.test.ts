/* SPDX-License-Identifier: AGPL-3.0-only */

// Persisted interruption reconstruction uses real native-code IDB/custody ports;
// it does not simulate abrupt browser death or a worker response.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { recoverManagedPhotoImportCurrentV1 } from '../src/lightscaper/import/photo-import-recovery-current-v1.ts';
import type { PhotoManagedImportPortsCurrentV1 } from '../src/lightscaper/import/managed-import-ports-current-v1.ts';
import { photoImportIntentKeyV1 } from '../src/lightscaper/import/import-intent-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture, mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const IMPORT = 'interrupted-import', TIME = '2026-10-11T00:00:00.000Z';
function observe<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function fixture() {
	const native = mediaRestoreFixture(), mediaName = `lightscaper-photo-current-recovery-${crypto.randomUUID()}`, catalogName = `repair-recovery-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, databaseName: mediaName, locks: null, preferOpfs: false, syncWorkerClient: null });
	await media.ready(); const masks = await media.getMaskRasterResources();
	const brush = await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(255) }, value => ({ reference: value.reference, bytes: value.bytes.slice() }));
	await masks.put(brush.reference, brush.bytes);
	const input = photoArchiveFixture(), initial = input.photo.versions[0]!.develop;
	const recipe = replaceImageDevelopRepairSpotsV1({ ...initial, processVersion: 2, effects: [], masks: [{ schemaVersion: 2, id: 'brush', name: 'Retained body', kind: 'mask',
		inputs: [{ name: 'Brush', sourceRef: brush.reference.storageKey, kind: 'raster' }], nodes: [{ id: 'out', kind: 'raster', inputName: 'Brush', channel: 'alpha' }], outputNodeId: 'out' }],
		maskBindings: [] }, { schemaVersion: 1, spots: [] });
	const photo = normalizePhotoDocumentCurrentV1({ ...input.photo, schemaVersion: 3, versions: [{ ...input.photo.versions[0], workspace: { schemaVersion: 3, kind: 'photo-develop-workspace',
		entries: [{ label: 'Original', createdAt: TIME, develop: initial }, { label: 'Redo', createdAt: TIME, develop: recipe }], cursor: 0,
		snapshots: [{ id: 'saved', name: 'Body', createdAt: TIME, develop: recipe }] } }] });
	const verify: NonNullable<PhotoManagedImportPortsCurrentV1['verifyResources']> = async (value, signal) => {
		assert.deepEqual(value, photo); await masks.source.withBytes(brush.reference, () => undefined, { signal });
	};
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: catalogName, verifyOriginal: media.verifyOriginal, verifyResources: verify });
	try {
		await catalog.createCatalog({ ...mediaRestoreRoot(0), revision: 0 }); await media.mediaRepository.writeAsset(photo.original.storageKey, input.original);
		await media.settingsRepository.put(photoImportIntentKeyV1(photo.catalogId), { schemaVersion: 1, kind: 'photo-import', catalogId: photo.catalogId, importId: IMPORT });
		await media.mediaRepository.catalogOriginals.stage(photo.catalogId, IMPORT, [{ photoId: photo.id, sourceId: photo.original.id,
			assetId: photo.original.storageKey, sha256: photo.original.contentSha256, size: photo.original.byteLength }]);
		await catalog.publishPhotos(photo.catalogId, 0, [photo]);
	} catch (error) { await Promise.all([catalog.close(), media.close()]); throw error; }
	const ports: PhotoManagedImportPortsCurrentV1 = { catalog, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
		journal: media.settingsRepository, verifyResources: verify, exclusive: async (_id, run, signal) => run(signal) };
	const staged = () => media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId, importId: IMPORT });
	const committed = () => media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
	const intent = () => media.settingsRepository.get(photoImportIntentKeyV1(photo.catalogId));
	return { native, mediaName, catalog, media, masks, photo, brush, ports, staged, committed, intent,
		close: () => Promise.all([catalog.close(), media.close()]) };
}

test('Current recovery verifies brush-only retained redo/snapshot closure before exact original root promotion', async () => {
	const f = await fixture(); let verified = 0;
	try {
		const before = { photo: await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id), metadata: await f.media.mediaRepository.getAssetMetadata(f.photo.original.storageKey) };
		const root = (await f.staged()).roots[0]; assert.ok(root);
		await recoverManagedPhotoImportCurrentV1(f.photo.catalogId, { ...f.ports, verifyResources: async (...args) => { verified++; await f.ports.verifyResources?.(...args); } });
		assert.equal(verified, 1); assert.equal((await f.staged()).roots.length, 0); assert.equal(await f.intent(), undefined);
		const committed = (await f.committed()).roots; assert.equal(committed.length, 1);
		assert.equal(committed[0]?.sourceId, root.sourceId); assert.equal(committed[0]?.assetId, root.assetId); assert.equal(committed[0]?.sha256, root.sha256);
		assert.deepEqual(await f.catalog.loadPhoto(f.photo.catalogId, f.photo.id), before.photo);
		assert.deepEqual(await f.media.mediaRepository.getAssetMetadata(f.photo.original.storageKey), before.metadata);
		await recoverManagedPhotoImportCurrentV1(f.photo.catalogId, f.ports); assert.equal((await f.committed()).roots.length, 1);
	} finally { await f.close(); }
});

test('missing selected verifier and missing real brush body retain interrupted evidence and allow an authenticated retry', async () => {
	const f = await fixture();
	try {
		const { verifyResources: _verify, ...missing } = f.ports;
		await assert.rejects(recoverManagedPhotoImportCurrentV1(f.photo.catalogId, missing), /resource/iu);
		assert.equal((await f.staged()).roots.length, 1); assert.ok(await f.intent());
		await f.native.remove(f.mediaName, 'analysis', f.brush.reference.storageKey);
		await assert.rejects(recoverManagedPhotoImportCurrentV1(f.photo.catalogId, f.ports), /missing/u);
		assert.equal((await f.staged()).roots.length, 1); assert.ok(await f.intent()); assert.equal((await f.committed()).roots.length, 0);
		await f.masks.put(f.brush.reference, f.brush.bytes); await recoverManagedPhotoImportCurrentV1(f.photo.catalogId, f.ports);
		assert.equal((await f.committed()).roots.length, 1); assert.equal(await f.intent(), undefined);
	} finally { await f.close(); }
});

test('native opaque cancellation during genuine borrowed brush verification joins without promoting or retiring evidence', async () => {
	const f = await fixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const reason = Proxy.revocable({}, {}); reason.revoke(); let borrowed: Uint8Array<ArrayBuffer> | undefined;
	const work = observe(recoverManagedPhotoImportCurrentV1(f.photo.catalogId, { ...f.ports,
		verifyResources: async (_photo, signal) => f.masks.source.withBytes(f.brush.reference, async bytes => {
			borrowed = bytes; entered.resolve(); await release.promise; signal?.throwIfAborted();
		}, { signal }) }, { signal: stop.signal }));
	try {
		const reached = await Promise.race([entered.promise.then(() => true), work.then(() => false)]); assert.equal(reached, true);
		stop.abort(reason.proxy); assert.equal(await remainsPending(work), true);
		assert.equal((await f.staged()).roots.length, 1); assert.ok(await f.intent()); release.resolve();
		const result = await work; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, reason.proxy);
		assert.ok(borrowed); assert.ok(borrowed.every(value => value === 0));
		assert.equal((await f.staged()).roots.length, 1); assert.ok(await f.intent()); assert.equal((await f.committed()).roots.length, 0);
	} finally { release.resolve(); await work; await f.close(); }
});

test('Current recovery fully admits and compares immutable original facts before any body verifier or custody mutation', async () => {
	const f = await fixture(); let verified = 0;
	try {
		const foreign = normalizePhotoDocumentCurrentV1({ ...f.photo, original: { ...f.photo.original, storageKey: 'foreign-original' } });
		const ports: PhotoManagedImportPortsCurrentV1 = { ...f.ports, catalog: { loadCatalog: (...args) => f.catalog.loadCatalog(...args),
			publishPhotos: (...args) => f.catalog.publishPhotos(...args), loadPhoto: async () => foreign }, verifyResources: async () => { verified++; } };
		await assert.rejects(recoverManagedPhotoImportCurrentV1(f.photo.catalogId, ports), /conflict/iu); assert.equal(verified, 0);
		assert.equal((await f.staged()).roots.length, 1); assert.ok(await f.intent()); assert.equal((await f.committed()).roots.length, 0);
	} finally { await f.close(); }
});
