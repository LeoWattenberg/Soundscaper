/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoLibrarySessionV3 } from '../src/lightscaper/photo-library-session-runtime-v3.ts';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoCommandOwnerCurrentV1 } from '../src/lightscaper/controller/photo-command-owner-current-v1.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { importManagedPhotosV2 } from '../src/lightscaper/import/managed-import-v2.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { createPhotoCatalogRestoreStageV1 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v1.ts';
import { createPhotoMediaRestoreNamespaceV1 } from '../src/lightscaper/storage/photo-media-restore-namespace-v1.ts';
import { photoLibraryRestorePointerV2, resolvePhotoLibraryLocationV2 } from '../src/lightscaper/storage/photo-library-location-v2.ts';
import { photoLibraryRestoreCommitV1, photoLibraryRestoreCommitKeyV1 } from '../src/lightscaper/storage/photo-library-restore-journal-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { mediaRestoreAllocation, mediaRestoreFixture, mediaRestoreRoot } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
const TIME = '2026-10-11T00:00:00.000Z';

function locks(): LockManager {
	const active = new Set<string>();
	return { async request(name: string, _options: unknown, run: (lock: unknown) => Promise<unknown>) {
		if (active.has(name)) return run(null);
		active.add(name);
		try { return await run({ name, mode: 'exclusive' }); } finally { active.delete(name); }
	} } as unknown as LockManager;
}

async function seed(restored: boolean) {
	const f = mediaRestoreFixture(), options = { name: 'Repairs', indexedDB: f.factory, locks: locks() };
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.factory, locks: null, preferOpfs: false });
	await anchor.ready();
	const allocation = mediaRestoreAllocation();
	if (restored) {
		const stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: f.names.catalogDatabaseName,
			root: mediaRestoreRoot(0), savedState: null, restoreAllocation: allocation });
		await stage.finish(); await stage.close();
		const media = await createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation }); await media.close();
		const receipt = { schemaVersion: 1, kind: 'photo-library-restore-ready', catalogId: allocation.catalogId, ...f.names,
			catalogRevision: 23, photoCount: 0, stackCount: 0, savedCollectionCount: 0, indexRevision: 0, originalCount: 0, originalByteLength: 0 };
		await anchor.settingsRepository.put(photoLibraryRestoreCommitKeyV1(allocation.namespaceToken), photoLibraryRestoreCommitV1({
			schemaVersion: 1, kind: 'photo-library-restore-journal', allocation,
			expectedPointer: { schemaVersion: 1, kind: 'photo-library', catalogId: 'catalog-1' }, phase: 'ready', candidateReceipt: receipt }));
		await anchor.settingsRepository.put(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, photoLibraryRestorePointerV2(allocation));
	} else {
		const empty = await createPhotoLibrarySessionV3(options);
		try { assert.equal((await empty.readPage()).totalCount, 0); } finally { await empty.close(); }
	}
	const pointer = await anchor.settingsRepository.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1);
	const location = resolvePhotoLibraryLocationV2(pointer, restored ? allocation : undefined);
	await anchor.close();
	const media = new PhotoMediaStoreV1({ indexedDB: f.factory, databaseName: location.mediaDatabaseName, locks: null, preferOpfs: false });
	const legacy = new PhotoCatalogRepositoryV2({ indexedDB: f.factory, databaseName: location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	const input = photoArchiveFixture(), photo = normalizePhotoDocumentV1({ ...input.photo, catalogId: location.catalogId });
	try {
		const receipts = await importManagedPhotosV2(location.catalogId, [{ photo, original: input.original }], {
			catalog: legacy, media: { writeAsset: media.mediaRepository.writeAsset, custody: media.mediaRepository.catalogOriginals },
			journal: media.settingsRepository, exclusive: async (_id, run, signal) => run(signal) });
		assert.equal(receipts[0]?.status, 'imported', JSON.stringify(receipts));
	} finally { await legacy.close(); }
	const current = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.factory, databaseName: location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	try {
		const owner = await PhotoCommandOwnerCurrentV1.open(current, photo.catalogId, photo.id);
		try {
			const repair = replaceImageDevelopRepairSpotsV1(photo.versions[0]!.develop, { schemaVersion: 1, spots: [{ id: 'retained-clone',
				mode: 'clone', enabled: true, target: { x: 0.5, y: 0.5 }, source: { x: 0, y: 0 }, radius: 0.25, feather: 0, opacity: 1 }] });
			await owner.execute({ type: 'record-develop', versionId: 'version-1', develop: repair, label: 'Repair', createdAt: TIME });
			await owner.execute({ type: 'save-develop-snapshot', versionId: 'version-1', id: 'repair-snapshot', name: 'Repair', createdAt: TIME });
			await owner.execute({ type: 'select-develop-history', versionId: 'version-1', cursor: 0 });
		} finally { await owner.close(); }
	} finally { await current.close(); await media.close(); }
	return { f, options, location, pointer, photo, original: input.original };
}

for (const restored of [false, true]) test(`selected ${restored ? 'allocated' : 'default'} Current route preserves retained repairs through metadata, memberships, restore and reopen`, async () => {
	const f = await seed(restored), session = await createPhotoLibrarySessionCurrentV1(f.options);
	let savedRevision: number;
	try {
		assert.equal((await session.readPage()).totalCount, 1);
		const initial = await session.develop.read({ schemaVersion: 3, photoId: f.photo.id });
		assert.equal(initial.schemaVersion, 3); assert.equal(initial.develop.processVersion, 1);
		assert.equal(initial.snapshots[0]?.id, 'repair-snapshot'); assert.equal(initial.history.entries.length, 2);
		const metadata = await session.applyMetadata(f.photo.id, initial.revision, { title: 'Authored after repair' });
		assert.equal(metadata.metadata.title, 'Authored after repair'); assert.equal(metadata.revision, initial.revision + 1);
		const memberships = await session.readMemberships(f.photo.id);
		assert.equal(memberships.revision, metadata.revision);
		const ack = await session.develop.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: metadata.revision,
			command: { type: 'restore-develop-snapshot', versionId: 'version-1', snapshotId: 'repair-snapshot', label: 'Restore repair', createdAt: TIME } });
		assert.deepEqual(ack.notices, []); assert.equal(ack.snapshot.develop.processVersion, 3);
		assert.equal(ack.snapshot.develop.processVersion === 3 && ack.snapshot.develop.repairs.spots[0]?.id, 'retained-clone');
		const copy = await session.develop.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: ack.snapshot.revision,
			command: { type: 'create-virtual-copy', id: 'repair-copy', name: 'Repair copy', createdAt: TIME, sourceVersionId: 'version-1' } });
		assert.equal(copy.snapshot.develop.processVersion, 3); assert.equal(copy.snapshot.activeVersionId, 'repair-copy');
		savedRevision = copy.snapshot.revision;
		await assert.rejects(session.develop.apply({ schemaVersion: 3, photoId: f.photo.id, expectedRevision: metadata.revision,
			command: { type: 'activate-version', versionId: 'version-1' } }), { code: 'PHOTO_REVISION_CONFLICT' });
		await assert.rejects(session.readExportSidecar!({ catalogId: f.location.catalogId, photoId: f.photo.id,
			versionId: 'repair-copy', expectedRevision: savedRevision }, { signal: new AbortController().signal }));
	} finally { await session.close(); }
	const reopened = await createPhotoLibrarySessionCurrentV1(f.options);
	try {
		const snapshot = await reopened.develop.read({ schemaVersion: 3, photoId: f.photo.id });
		assert.equal(snapshot.revision, savedRevision); assert.equal(snapshot.develop.processVersion, 3);
		assert.equal((await reopened.readMetadata(f.photo.id)).metadata.title, 'Authored after repair');
	} finally { await reopened.close(); }
	const legacy = await createPhotoLibrarySessionV3(f.options);
	try { await assert.rejects(legacy.develop.read({ schemaVersion: 2, photoId: f.photo.id })); }
	finally { await legacy.close(); }
	const media = new PhotoMediaStoreV1({ indexedDB: f.f.factory, databaseName: f.location.mediaDatabaseName, locks: null, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: f.f.factory, databaseName: f.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
	try {
		const saved = await catalog.loadPhoto(f.location.catalogId, f.photo.id); assert.ok(saved);
		assert.equal(saved.schemaVersion, 3); assert.deepEqual(saved.original, f.photo.original);
		assert.equal(saved.versions[0]?.workspace?.entries[1]?.develop.processVersion, 3);
		assert.deepEqual(new Uint8Array(await (await media.mediaRepository.loadAsset(saved.original.storageKey))!.arrayBuffer()),
			new Uint8Array(await f.original.arrayBuffer()));
	} finally { await catalog.close(); await media.close(); }
});
