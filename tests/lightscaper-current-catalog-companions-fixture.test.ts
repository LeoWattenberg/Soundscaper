/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createHash } from 'node:crypto';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import type { PhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';
import type { PhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';
import type { PhotoSmartCollectionsStateV1 } from '../src/lightscaper/catalog/photo-smart-collection-state-v1.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { readCurrentCatalogCompanionsV1 } from './helpers/lightscaper-current-catalog-companions-fixture.ts';
import { currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { lutArchiveFixture, LUT_BODY } from './helpers/lightscaper-lut-archive-fixture.ts';

const priorRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (priorRange) Object.defineProperty(globalThis, 'IDBKeyRange', priorRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const IDS = ['photo-1', 'photo-2'];
const query: PhotoSmartCollectionV1['query'] = { schemaVersion: 2, kind: 'photo-catalog-query', text: 'source', filter: null,
	sort: { field: 'file-name', direction: 'ascending' }, predicate: { kind: 'presence', column: 'lens', value: 'unknown' } };

async function defaultLibrary() {
	const native = mediaRestoreFixture(), locks = currentAppLocks(), records = [photoArchiveFixture(1, new Uint8Array([9, 8, 7])), photoArchiveFixture(2)];
	const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, verifyOriginal: media.verifyOriginal });
	const root = { ...lutArchiveFixture().root, name: 'Default collision', revision: 0, photoCount: 0 };
	await catalog.createCatalog(root);
	for (const record of records) await media.mediaRepository.writeAsset(record.photo.original.storageKey, record.original);
	await catalog.publishPhotos(root.id, 0, records.map(record => record.photo));
	await media.mediaRepository.catalogOriginals.retain(root.id, records.map(({ photo }) => ({ photoId: photo.id, assetId: photo.original.storageKey,
		sourceId: photo.original.id, sha256: photo.original.contentSha256, size: photo.original.byteLength })));
	await media.settingsRepository.put(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, { schemaVersion: 1, kind: 'photo-library', catalogId: root.id });
	return { native, locks, media, catalog, records, async close() { await Promise.all([media.close(), catalog.close()]); } };
}

test('current companions refuse an unbounded selection before opening storage and never initialize a library', async () => {
	const native = mediaRestoreFixture();
	for (const ids of [[], ['same', 'same'], ['a', 'b', 'c', 'd', 'e'], [''], ['x'.repeat(257)]]) {
		await assert.rejects(readCurrentCatalogCompanionsV1(ids, native.factory));
	}
	assert.deepEqual(native.opens, []);
	await assert.rejects(readCurrentCatalogCompanionsV1(IDS, native.factory), /initialize|selected library/u);
	assert.equal(native.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).recordCount(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'settings'), 0);
});

test('current companions authenticate actual default full documents, ordered stacks, physical saved state, bodies and custody without writing', async () => {
	const x = await defaultLibrary();
	try {
		const root = await x.catalog.loadCatalog('catalog-1'); assert.ok(root);
		const stack = await x.catalog.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id, id: 'default-stack', revision: 0,
			photoIds: [...IDS].reverse(), coverPhotoId: IDS[0] }, null, { expectedCatalogRevision: root.revision, expectedStateRevision: 0 });
		const context = await x.catalog.readSmartCollectionArchiveContextV1(root.id);
		const receipt = await x.catalog.saveSmartCollection({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id,
			id: 'default-saved', revision: 0, name: 'Complete criteria', query }, null,
			{ expectedCatalogRevision: context.catalogRevision, expectedIndexRevision: context.indexRevision, expectedStateRevision: 0 });
		const saved = await x.catalog.loadSmartCollection(root.id, 'default-saved'); assert.ok(saved);
		const before = x.native.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'mediaAssets');
		const observed = await readCurrentCatalogCompanionsV1(IDS, x.native.factory);
		assert.equal(observed.namespace, null); assert.deepEqual(observed.root, await x.catalog.loadCatalog(root.id));
		assert.deepEqual(observed.stacks, [stack]); assert.equal(observed.stackState.stackCount, 1);
		assert.deepEqual(observed.savedState, receipt.state); assert.deepEqual(observed.saved, [saved]);
		assert.deepEqual(observed.previews, []);
		for (const [index, item] of observed.photos.entries()) {
			const expected = x.records[index]!; assert.deepEqual(item.photo, expected.photo);
			assert.deepEqual(item.bytes, [...new Uint8Array(await expected.original.arrayBuffer())]);
			assert.equal(item.actualSha256, expected.photo.original.contentSha256); assert.equal(item.authority.catalogRootCount, 1);
			assert.equal(item.authority.roots[0]!.photoId, expected.photo.id); assert.equal(item.authority.roots[0]!.importId, null);
			assert.equal(item.authority.roots[0]!.mediaContentToken, item.authority.mediaContentToken);
		}
		assert.deepEqual(x.native.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'mediaAssets'), before);
	} finally { await x.close(); }
});

test('current companions follow real same-ID Restore2 private allocation with mixed Photo1/Photo2, complete disabled LUT custody and unchanged default collisions', async () => {
	const x = await defaultLibrary(), current = lutArchiveFixture(), legacy = photoArchiveFixture(2);
	const root = { ...current.root, photoCount: 2 };
	const stack: PhotoStackV1 = { schemaVersion: 1, kind: 'photo-stack', catalogId: root.id, id: 'private-stack', revision: 3,
		photoIds: [...IDS].reverse(), coverPhotoId: IDS[1] };
	const saved: PhotoSmartCollectionV1 = { schemaVersion: 1, kind: 'photo-smart-collection', catalogId: root.id, id: 'private-saved', revision: 4, name: 'Private criteria', query };
	const state: PhotoSmartCollectionsStateV1 = { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: root.id, revision: 5, collectionCount: 1 };
	const runtime = createPhotoLibraryRestoreRuntimeV2({ name: 'Private library', indexedDB: x.native.factory, locks: x.locks });
	try {
		const defaultRows = x.native.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'mediaAssets');
		const defaultPhotos = await Promise.all(IDS.map(id => x.catalog.loadPhoto(root.id, id)));
		const archive = await exportPhotoCatalogArchiveV5(root, [current.record, legacy], [stack], state, [saved], current.row,
			{ async withBytes(_reference, consume) { return consume(LUT_BODY); } });
		assert.ok(archive.blob); assert.equal((await runtime.restoreArchive(archive.blob)).photoCount, 2);
		const observed = await readCurrentCatalogCompanionsV1(IDS, x.native.factory);
		assert.match(observed.namespace!, /^[a-f0-9]{32}$/u); assert.deepEqual(observed.root, root);
		assert.deepEqual(observed.photos.map(item => item.photo), [current.record.photo, legacy.photo]);
		assert.deepEqual(observed.photos.map(item => item.bytes), [[1, 2, 3], [1, 2, 3]]);
		assert.deepEqual(observed.stacks, [stack]); assert.equal(observed.stackState.stackCount, 1);
		assert.deepEqual(observed.savedState, state); assert.deepEqual(observed.saved, [saved]); assert.deepEqual(observed.previews, []);
		for (const item of observed.photos) {
			assert.equal(item.actualSha256, createHash('sha256').update(new Uint8Array(item.bytes)).digest('hex'));
			assert.equal(item.authority.catalogRootCount, 1); assert.equal(item.authority.roots[0]!.importId, null);
			assert.equal(item.authority.roots[0]!.photoId, item.photo.id); assert.equal(item.authority.roots[0]!.mediaContentToken, item.authority.mediaContentToken);
		}
		assert.deepEqual(await Promise.all(IDS.map(id => x.catalog.loadPhoto(root.id, id))), defaultPhotos);
		assert.deepEqual(x.native.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'mediaAssets'), defaultRows);
		const stale = await x.media.mediaRepository.loadAsset('original-1'); assert.ok(stale instanceof Blob);
		assert.deepEqual([...new Uint8Array(await stale.arrayBuffer())], [9, 8, 7]);
	} finally { await Promise.all([runtime.close(), x.close()]); }
});

test('current companions refuse native original-body corruption and missing committed custody without repairing either', async () => {
	const x = await defaultLibrary(), database = await openDatabase(x.native.factory, PHOTO_MEDIA_NAMESPACES_V1.databaseName);
	try {
		const originalRow = await transact(database, 'mediaAssets', 'readwrite', async stores => {
			const row = await request<Record<string, unknown>>(stores.mediaAssets.get('original-1'));
			await request(stores.mediaAssets.put({ ...row, blob: new Blob([new Uint8Array([0, 0, 0])]) }));
			return row;
		});
		await assert.rejects(readCurrentCatalogCompanionsV1(IDS, x.native.factory), /body|digest/u);
		const corrupted = await x.media.mediaRepository.loadAsset('original-1'); assert.ok(corrupted instanceof Blob);
		assert.deepEqual([...new Uint8Array(await corrupted.arrayBuffer())], [0, 0, 0]);
		await transact(database, 'mediaAssets', 'readwrite', stores => request(stores.mediaAssets.put(originalRow)));
		await transact(database, 'catalogOriginalRoots', 'readwrite', async stores => {
			await request(stores.catalogOriginalRoots.clear());
		});
		await assert.rejects(readCurrentCatalogCompanionsV1(IDS, x.native.factory), /custody/u);
		assert.equal(x.native.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).recordCount(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'catalogOriginalRoots'), 0);
	} finally { database.close(); await x.close(); }
});
