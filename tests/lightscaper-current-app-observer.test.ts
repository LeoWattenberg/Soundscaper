/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { after } from 'node:test';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { readResidentPhotoLibraryCurrent, seedCurrentAppPhoto, currentAppLocks } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { lutArchiveFixture, LUT_BODY } from './helpers/lightscaper-lut-archive-fixture.ts';

const priorRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (priorRange) Object.defineProperty(globalThis, 'IDBKeyRange', priorRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

/** Only the filesystem boundary is supplied: actual MediaRepository/OPFS
 * owners choose the backend and preserve native Blob bytes and metadata. */
function filesystem() {
	const directories = new Map<string, Map<string, Blob>>(), reads: string[] = [];
	let rootReads = 0;
	const storage = { async getDirectory() {
		rootReads++;
		return { async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions) {
			let files = directories.get(name);
			if (!files) { if (!options?.create) throw new DOMException('Missing directory', 'NotFoundError'); files = new Map(); directories.set(name, files); }
			const captured = files;
			return { async getFileHandle(path: string, demand?: FileSystemGetFileOptions) {
				if (!captured.has(path) && !demand?.create) throw new DOMException('Missing file', 'NotFoundError');
				return { async getFile() {
					reads.push(path); const body = captured.get(path); if (!body) throw new DOMException('Missing body', 'NotFoundError');
					return new File([body], path, { type: body.type });
				}, async createWritable() {
					let body: Blob | null = null;
					return { async write(value: Blob) { assert.ok(value instanceof Blob); body = value; },
						async close() { assert.ok(body); captured.set(path, body); }, async abort() { body = null; } };
				} };
			}, async removeEntry(path: string) { captured.delete(path); } };
		} };
	} };
	const prior = Object.getOwnPropertyDescriptor(globalThis.navigator, 'storage');
	Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: storage });
	return { directories, reads, rootReads: () => rootReads,
		restore() { if (prior) Object.defineProperty(globalThis.navigator, 'storage', prior); else Reflect.deleteProperty(globalThis.navigator, 'storage'); } };
}

test('current observer loads the actual default OPFS original with its complete admitted key, digest and bytes', async () => {
	const fs = filesystem(), native = mediaRestoreFixture(), locks = currentAppLocks();
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryV2 | null = null;
	try {
		const seeded = await seedCurrentAppPhoto(native.factory, locks), bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
		const digest = createHash('sha256').update(bytes).digest('hex');
		const photo = normalizePhotoDocumentV1({ ...seeded.photo, id: 'opfs-photo', original: { ...seeded.photo.original,
			id: 'opfs-source', storageKey: 'opfs-original', name: 'Native original.png', byteLength: bytes.length, contentSha256: digest } });
		media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks });
		catalog = new PhotoCatalogRepositoryV2({ indexedDB: native.factory, verifyOriginal: media.verifyOriginal });
		await media.mediaRepository.writeAsset(photo.original.storageKey, new Blob([bytes], { type: photo.original.mimeType }));
		const row = native.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'mediaAssets')
			.find(value => value.sourceId === photo.original.storageKey);
		assert.ok(row); assert.equal(row.storage, 'opfs'); assert.equal(row.sha256, digest); assert.equal(row.size, bytes.length);
		assert.equal(typeof row.path, 'string'); assert.equal(row.blob, undefined);
		const root = await catalog.loadCatalog(photo.catalogId); assert.ok(root);
		await catalog.publishPhotos(photo.catalogId, root.revision, [photo]);
		await media.mediaRepository.catalogOriginals.retain(photo.catalogId, [{ photoId: photo.id, assetId: photo.original.storageKey,
			sourceId: photo.original.id, sha256: digest, size: bytes.length }]);
		await catalog.close(); catalog = null; await media.close(); media = null;
		const observed = await readResidentPhotoLibraryCurrent([photo.id], native.factory);
		assert.equal(observed.namespace, null); assert.equal(observed.root?.id, photo.catalogId);
		assert.deepEqual(observed.photos, [{ photo, bytes: [...bytes] }]);
		assert.equal(createHash('sha256').update(new Uint8Array(observed.photos[0]!.bytes)).digest('hex'), digest);
		assert.ok(fs.reads.includes(row.path as string)); assert.ok(fs.rootReads() > 0);
		assert.equal(fs.directories.get(PHOTO_MEDIA_NAMESPACES_V1.opfsDirectoryName)?.size, 1);
	} finally { await Promise.all([media?.close(), catalog?.close()]); fs.restore(); }
});

test('current observer follows actual private Restore2 IDB allocation and authenticates Photo2 and disabled LUT custody without OPFS reads', async () => {
	const fs = filesystem(), native = mediaRestoreFixture(), expected = lutArchiveFixture(), locks = currentAppLocks();
	const restore = createPhotoLibraryRestoreRuntimeV2({ name: 'Restored library', indexedDB: native.factory, locks });
	const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
	try {
		const staleBytes = new Uint8Array([9, 8, 7]);
		await anchor.mediaRepository.writeAsset(expected.record.photo.original.storageKey, new Blob([staleBytes]));
		const output = await exportPhotoCatalogArchiveV5(expected.root, [expected.record], [], null, [], expected.row,
			{ async withBytes(_reference, consume) { return consume(LUT_BODY); } });
		assert.ok(output.blob); assert.equal((await restore.restoreArchive(output.blob)).photoCount, 1);
		const selected = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { assert.fail('Private observation must not initialize default storage.'); } });
		assert.ok(selected.allocation); assert.match(selected.location.namespaceToken!, /^[a-f0-9]{32}$/u);
		const databaseName = selected.location.mediaDatabaseName;
		const row = native.raw(databaseName).records(databaseName, 'mediaAssets').find(value => value.sourceId === expected.record.photo.original.storageKey);
		assert.ok(row); assert.notEqual(row.storage, 'opfs'); assert.equal(row.sha256, expected.record.photo.original.contentSha256);
		assert.equal(row.size, expected.record.photo.original.byteLength); assert.equal(row.path, undefined);
		const observed = await readResidentPhotoLibraryCurrent([expected.record.photo.id], native.factory);
		assert.equal(observed.namespace, selected.location.namespaceToken); assert.deepEqual(observed.root, expected.root);
		const original = new Uint8Array(await expected.record.original.arrayBuffer());
		assert.deepEqual(observed.photos, [{ photo: expected.record.photo, bytes: [...original] }]);
		assert.equal(createHash('sha256').update(new Uint8Array(observed.photos[0]!.bytes)).digest('hex'), expected.record.photo.original.contentSha256);
		const retained = await anchor.mediaRepository.loadAsset(expected.record.photo.original.storageKey); assert.ok(retained instanceof Blob);
		assert.deepEqual(new Uint8Array(await retained.arrayBuffer()), staleBytes);
		assert.equal(fs.rootReads(), 0); assert.deepEqual(fs.reads, []); assert.equal(fs.directories.size, 0);
	} finally { await Promise.all([restore.close(), anchor.close()]); fs.restore(); }
});
