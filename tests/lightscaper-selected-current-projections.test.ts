/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCommandOwnerCurrentV1 } from '../src/lightscaper/controller/photo-command-owner-current-v1.ts';
import { readPhotoLibraryMetadataSnapshotCurrentV1 } from '../src/lightscaper/controller/photo-library-metadata-current-v1.ts';
import { readPhotoLibraryMetadataSnapshotV2 } from '../src/lightscaper/controller/photo-library-metadata-v2.ts';
import { readPhotoLibraryMembershipsCurrentV1, applyPhotoLibraryMembershipsCurrentV1 } from '../src/lightscaper/controller/photo-library-memberships-current-v1.ts';
import { readPhotoLibraryMembershipsV2 } from '../src/lightscaper/controller/photo-library-memberships-v2.ts';
import { readPhotoLibraryOriginalInspectionPageCurrentV1, type PhotoLibraryOriginalInspectionPortsCurrentV1 } from '../src/lightscaper/controller/photo-library-original-inspection-current-v1.ts';
import { readPhotoLibraryOriginalInspectionPageV2 } from '../src/lightscaper/controller/photo-library-original-inspection-v2.ts';
import { restorePhotoLibraryOriginalBodyCurrentV1 } from '../src/lightscaper/controller/photo-library-original-restoration-current-v1.ts';
import { restorePhotoLibraryOriginalBodyV2 } from '../src/lightscaper/controller/photo-library-original-restoration-v2.ts';
import { PhotoPreviewSchedulerCurrentV1 } from '../src/lightscaper/preview/photo-preview-scheduler-current-v1.ts';
import { PhotoPreviewSchedulerV2 } from '../src/lightscaper/preview/photo-preview-scheduler-v2.ts';
import type { PhotoPreviewCachePortV1 } from '../src/lightscaper/preview/photo-preview-cache-v1.ts';
import type { PreparedPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import type { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
const CREATED = '2026-10-11T00:00:00.000Z';
function repairedPhoto() {
	const legacy = photoArchiveFixture().photo, master = legacy.versions[0]!;
	const develop = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV1(), { schemaVersion: 1, spots: [
		{ id: 'disabled-clone', mode: 'clone', enabled: false, target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 },
			radius: 0.1, feather: 0.25, opacity: 0.5 },
	] });
	return normalizePhotoDocumentCurrentV1({ ...legacy, schemaVersion: 3, versions: [{ ...master, workspace: {
		schemaVersion: 3, kind: 'photo-develop-workspace', entries: [
			{ label: 'Original', createdAt: CREATED, develop: master.develop }, { label: 'Redo repair', createdAt: CREATED, develop }], cursor: 0,
		snapshots: [{ id: 'saved-repair', name: 'Saved repair', createdAt: CREATED, develop }] } },
	{ ...master, id: 'inactive-copy', kind: 'virtual-copy', name: 'Inactive repair', develop }] });
}
async function fixture(context: TestContext) {
	const raw = createInstrumentedIndexedDB(), indexedDB = raw as unknown as IDBFactory, name = `lightscaper-current-projections-${crypto.randomUUID()}`;
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: name, locks: null, preferOpfs: false, syncWorkerClient: null });
	const repository = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: `${name}-catalog`, verifyOriginal: media.verifyOriginal });
	const owners: PhotoCommandOwnerCurrentV1[] = [];
	context.after(async () => { await Promise.all(owners.map(owner => owner.close())); await repository.close(); await media.close(); });
	const source = photoArchiveFixture(), photo = repairedPhoto();
	await repository.createCatalog(normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: photo.catalogId, name: 'Current selected library', revision: 0, photoCount: 0,
		folders: [{ id: 'folder', name: 'Folder', parentId: null }], keywords: [], collections: [] }));
	await media.mediaRepository.writeAsset(photo.original.storageKey, source.original, { name: photo.original.name, mimeType: photo.original.mimeType });
	await media.mediaRepository.catalogOriginals.retain(photo.catalogId, [{ photoId: photo.id, sourceId: photo.original.id,
		assetId: photo.original.storageKey, sha256: photo.original.contentSha256, size: photo.original.byteLength }]);
	await repository.publishPhotos(photo.catalogId, 0, [photo]);
	const ports: PhotoLibraryOriginalInspectionPortsCurrentV1 = { catalog: repository, journal: media.settingsRepository,
		media: { custody: media.mediaRepository.catalogOriginals },
		originalInspection: { inspect: (binding, signal) => media.mediaRepository.inspectCatalogOriginalBody(binding, { signal }) } };
	return { raw, indexedDB, name, media, repository, source, photo, ports,
		async owner() { const owner = await PhotoCommandOwnerCurrentV1.open(repository, photo.catalogId, photo.id); owners.push(owner); return owner; } };
}
function previewOptions(photo: unknown) {
	let current = photo, cached: PreparedPhotoPreviewV1 | null = null;
	const stats = { reads: 0, decodes: 0, stores: 0 };
	const pixels = Uint8Array.of(12, 34, 56, 255), frame = { descriptor: { schemaVersion: 1 as const, width: 1, height: 1,
		sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels };
	const cache: PhotoPreviewCachePortV1 = { load: async () => cached, store: async () => { stats.stores++; return { outcome: 'stored' }; },
		trim: async () => ({ removedEntries: 0, removedBytes: 0, more: false }) };
	const regenerate: typeof withPhotoOriginalFrameV1 = async (_value, consume) => { stats.decodes++; return consume(frame, { orientation: 1, runtimeVersion: 'current-original-preview' }); };
	const options = { catalogId: 'catalog-1', cache, loadPhoto: async () => current,
		loadOriginal: async () => { stats.reads++; return photoArchiveFixture().original; }, regenerate };
	return { stats, pixels, options, replace(value: unknown) { current = value; }, cache(value: PreparedPhotoPreviewV1) { cached = value; } };
}

test('Current scalar metadata fully admits retained repair history without exporting recipes or original custody', () => {
	const photo = repairedPhoto(), before = JSON.stringify(photo), expected = readPhotoLibraryMetadataSnapshotV2(photoArchiveFixture().photo);
	const result = readPhotoLibraryMetadataSnapshotCurrentV1(photo);
	assert.deepEqual(result, expected); assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.metadata), true);
	assert.deepEqual(Object.keys(result).sort(), ['extracted', 'metadata', 'originalFileName', 'originalSha256', 'photoId', 'revision']);
	assert.equal(JSON.stringify(photo), before); assert.throws(() => readPhotoLibraryMetadataSnapshotV2(photo));
	assert.equal(JSON.stringify(readPhotoLibraryMetadataSnapshotCurrentV1(photoArchiveFixture().photo)), JSON.stringify(expected));
});

test('Current scalar metadata refuses malformed inactive, redo, snapshot and accessor recipes before projection', () => {
	const photo = repairedPhoto(), master = photo.versions[0]!, workspace = master.workspace!;
	let reads = 0;
	const malformed = { processVersion: 99 }, candidates = [
		{ ...photo, versions: [master, { ...photo.versions[1], develop: malformed }] },
		{ ...photo, versions: [{ ...master, workspace: { ...workspace, entries: [workspace.entries[0], { ...workspace.entries[1], develop: malformed }] } }] },
		{ ...photo, versions: [{ ...master, workspace: { ...workspace, snapshots: [{ ...workspace.snapshots[0], develop: malformed }] } }] },
		Object.defineProperty({ ...photo }, 'versions', { enumerable: true, get() { reads++; return []; } }),
		{ ...photo, schemaVersion: 4 },
	];
	for (const candidate of candidates) assert.throws(() => readPhotoLibraryMetadataSnapshotCurrentV1(candidate));
	assert.equal(reads, 0);
});

test('Current membership edits use the actual native owner while retaining complete repair metadata and CAS', async context => {
	const f = await fixture(context), owner = await f.owner(), before = owner.history.present;
	assert.equal(readPhotoLibraryMembershipsCurrentV1(owner, f.photo.id).revision, 0);
	const ack = await applyPhotoLibraryMembershipsCurrentV1(owner, f.photo.id, 0, { folderId: 'folder' });
	assert.equal(ack.snapshot.revision, 1); assert.equal(ack.snapshot.folderId, 'folder'); assert.equal(Object.isFrozen(ack), true);
	assert.deepEqual(owner.history.present.versions, before.versions); assert.deepEqual(owner.history.present.original, before.original);
	assert.equal(owner.history.present.schemaVersion, 3); assert.equal((await f.repository.loadPhoto(f.photo.catalogId, f.photo.id))?.folderId, 'folder');
	await assert.rejects(applyPhotoLibraryMembershipsCurrentV1(owner, f.photo.id, 0, { folderId: null }), { code: 'PHOTO_REVISION_CONFLICT' });
	assert.throws(() => readPhotoLibraryMembershipsV2(owner as never, f.photo.id));
	assert.equal((await applyPhotoLibraryMembershipsCurrentV1(owner, f.photo.id, 1, { folderId: 'folder' })).snapshot.revision, 1);
});

test('Current membership admission native preabort precedes any hostile selected document reflection', async () => {
	const reason = Symbol('opaque preabort'), cancel = new AbortController(); cancel.abort(reason); let reads = 0;
	const value = new Proxy({}, { ownKeys() { reads++; assert.fail('Aborted document reflected'); } });
	const owner = { history: { present: value }, execute: () => assert.fail('Aborted membership executed') } as never;
	assert.throws(() => readPhotoLibraryMembershipsCurrentV1(owner, 'photo-1', { signal: cancel.signal }), error => error === reason);
	const outcome = await applyPhotoLibraryMembershipsCurrentV1(owner, 'photo-1', 0, {}, { signal: cancel.signal }).then(() => null, (error: unknown) => ({ error }));
	assert.equal(outcome?.error, reason); assert.equal(reads, 0);
});

test('Current membership native ACK survives late cancellation and Close joins the held delivery', async context => {
	const f = await fixture(context), entered = deferred<void>(), release = deferred<void>(), cancel = new AbortController();
	context.after(() => release.resolve());
	const save = f.repository.savePhoto;
	f.repository.savePhoto = async (...args) => { const ack = await Reflect.apply(save, f.repository, args); entered.resolve(); await release.promise; return ack; };
	const owner = await f.owner(), work = applyPhotoLibraryMembershipsCurrentV1(owner, f.photo.id, 0, { folderId: 'folder' }, { signal: cancel.signal });
	const outcome = work.then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
	await Promise.race([entered.promise, outcome.then(() => assert.fail('No actual held native save ACK'))]);
	const reason = Symbol('after native ACK'); cancel.abort(reason); const closing = owner.close();
	try { assert.equal(await remainsPending(closing), true); release.resolve();
		const result = await outcome; assert.equal(result.error, undefined); assert.equal(result.value?.snapshot.revision, 1); await closing;
		assert.deepEqual((await f.repository.loadPhoto(f.photo.catalogId, f.photo.id))?.versions, f.photo.versions);
	} finally { release.resolve(); await work.catch(() => undefined); await closing; }
});

test('Current original inspection and actual immutable restoration preserve all retained repairs', async context => {
	const f = await fixture(context), signal = new AbortController().signal;
	const page = await readPhotoLibraryOriginalInspectionPageCurrentV1(f.photo.catalogId, f.ports, null, null, signal), row = page.rows[0]; assert.ok(row);
	assert.deepEqual(row.inspection, { status: 'present' }); assert.equal(row.revision, 0);
	await assert.rejects(readPhotoLibraryOriginalInspectionPageV2(f.photo.catalogId, f.ports, null, null, signal));
	const database = await openDatabase(f.indexedDB, f.name); context.after(() => database.close());
	await transact(database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => request(mediaAssets.delete(f.photo.original.storageKey)));
	const missing = await readPhotoLibraryOriginalInspectionPageCurrentV1(f.photo.catalogId, f.ports, null, null, signal);
	assert.deepEqual(missing.rows[0]?.inspection, { status: 'missing', reason: 'media-row' });
	const target = { schemaVersion: 1 as const, catalogRevision: page.revision, activeImportId: page.activeImportId, photoRevision: row.revision, binding: row.binding };
	const ports = { catalog: f.repository, journal: f.media.settingsRepository, originalRestoration: {
		restoreCatalogOriginalBody: f.media.mediaRepository.restoreCatalogOriginalBody.bind(f.media.mediaRepository) } };
	await assert.rejects(restorePhotoLibraryOriginalBodyV2(f.photo.catalogId, ports, target, f.source.original, signal));
	const ack = await restorePhotoLibraryOriginalBodyCurrentV1(f.photo.catalogId, ports, target, f.source.original, signal);
	assert.deepEqual(ack, { photoId: f.photo.id, assetId: f.photo.original.storageKey, sha256: f.photo.original.contentSha256, size: f.source.original.size, notices: [] });
	assert.deepEqual((await readPhotoLibraryOriginalInspectionPageCurrentV1(f.photo.catalogId, f.ports, null, null, signal)).rows[0]?.inspection, { status: 'present' });
	assert.deepEqual(await f.repository.loadPhoto(f.photo.catalogId, f.photo.id), f.photo);
});

test('Current original wrappers reject malformed retained recipes before original capabilities and preserve native cancellation', async context => {
	const f = await fixture(context), signal = new AbortController().signal;
	const page = await readPhotoLibraryOriginalInspectionPageCurrentV1(f.photo.catalogId, f.ports, null, null, signal), row = page.rows[0]; assert.ok(row);
	const bad = { ...f.photo, versions: [f.photo.versions[0], { ...f.photo.versions[1], develop: { processVersion: 99 } }] }; let reads = 0;
	const catalog = { loadCatalog: f.repository.loadCatalog.bind(f.repository), loadPhoto: async () => bad };
	const inspect = { ...f.ports, catalog, originalInspection: { inspect: async () => { reads++; return { status: 'present' as const }; } } };
	await assert.rejects(readPhotoLibraryOriginalInspectionPageCurrentV1(f.photo.catalogId, inspect, null, null, signal));
	const target = { schemaVersion: 1 as const, catalogRevision: page.revision, activeImportId: page.activeImportId, photoRevision: row.revision, binding: row.binding };
	const restoration = { catalog, journal: f.media.settingsRepository,
		originalRestoration: { restoreCatalogOriginalBody: async () => { reads++; return { assetId: row.binding.assetId, sha256: row.binding.sha256, size: row.binding.size }; } } };
	await assert.rejects(restorePhotoLibraryOriginalBodyCurrentV1(f.photo.catalogId, restoration, target, f.source.original, signal));
	const cancel = new AbortController(), reason = Symbol('native wrapper cancellation'); cancel.abort(reason);
	const result = await readPhotoLibraryOriginalInspectionPageCurrentV1(f.photo.catalogId, inspect, null, null, cancel.signal).then(() => null, (error: unknown) => ({ error }));
	assert.equal(result?.error, reason); assert.equal(reads, 0);
});

test('Current original-only preview retains exact immutable pixels and cache identity across repaired and legacy documents', async () => {
	const f = previewOptions(repairedPhoto()), scheduler = new PhotoPreviewSchedulerCurrentV1(f.options);
	try {
		const ready = await scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' }); assert.equal(ready.outcome, 'ready');
		if (ready.outcome !== 'ready') assert.fail('Original preview missing');
		assert.deepEqual(new Uint8Array(await ready.preview.body.arrayBuffer()), f.pixels);
		f.cache(ready.preview); f.replace({ ...photoArchiveFixture().photo, revision: 1, rating: 5 });
		const hit = await scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' });
		assert.equal(hit.outcome, 'ready'); if (hit.outcome !== 'ready') assert.fail('Legacy cache hit missing');
		assert.equal(hit.cache, 'hit'); assert.equal(hit.preview, ready.preview); assert.deepEqual(f.stats, { reads: 1, decodes: 1, stores: 1 });
	} finally { await scheduler.close(); }
	const strict = new PhotoPreviewSchedulerV2(previewOptions(repairedPhoto()).options);
	try { await assert.rejects(strict.request({ photoId: 'photo-1', tier: 'thumbnail' })); } finally { await strict.close(); }
});

test('Current preview refuses malformed inactive recipes before original reads and joins a held Current read on Close', async () => {
	const photo = repairedPhoto(), f = previewOptions({ ...photo, versions: [photo.versions[0], { ...photo.versions[1], develop: { processVersion: 99 } }] });
	const refused = new PhotoPreviewSchedulerCurrentV1(f.options);
	try { await assert.rejects(refused.request({ photoId: 'photo-1', tier: 'thumbnail' })); assert.equal(f.stats.reads, 0); }
	finally { await refused.close(); }
	const entered = deferred<void>(), release = deferred<void>(), valid = previewOptions(photo);
	const options = { ...valid.options, async loadPhoto() { assert.equal(this, options); entered.resolve(); await release.promise; return photo; } };
	const scheduler = new PhotoPreviewSchedulerCurrentV1(options), work = scheduler.request({ photoId: 'photo-1', tier: 'thumbnail' });
	const outcome = work.then(() => true, () => false); await entered.promise;
	Reflect.set(options, 'loadPhoto', async () => assert.fail('Replaced Current reader invoked'));
	const closing = scheduler.close();
	try { assert.equal(await remainsPending(closing), true); assert.equal(scheduler.close(), closing); }
	finally { release.resolve(); await closing; assert.equal(await outcome, false); }
	assert.deepEqual(valid.stats, { reads: 0, decodes: 0, stores: 0 });
});
