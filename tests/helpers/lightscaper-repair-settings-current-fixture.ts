/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createPhotoLibrarySessionCurrentV1 } from '../../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMaskRasterRepositoryV1 } from '../../src/lightscaper/storage/photo-mask-raster-repository-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { applyPhotoCommandCurrentV1 } from '../../src/lightscaper/controller/photo-commands-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { withPreparedBrushMaskResourceV1, type BrushMaskResourceReferenceV1 } from '../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { PhotoDocumentCurrentV1 } from '../../src/lightscaper/catalog/photo-document-current-v1.ts';
import type { ExecutePhotoDevelopCurrentV1 } from '../../src/common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import { request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { photoArchiveFixture } from './lightscaper-photo-fixture.ts';
import { mediaRestoreFixture } from './lightscaper-media-restore-fixture.ts';
import { currentAppLocks } from './lightscaper-current-app-fixture.tsx';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';
import { pngBytes, repairRecipe, ORIGINAL } from './lightscaper-repair-raster-export-current-fixture.ts';

export const SETTINGS_TIME = '2026-10-12T00:00:00.000Z';
export const FULL_SETTINGS_SELECTION = Object.freeze({ effectTypes: 'all' as const, geometry: true, localAdjustments: true, repairs: true });
export function brushSettingsRecipe(reference: Readonly<BrushMaskResourceReferenceV1>, base: ImageDevelopStateCurrentV1 = repairRecipe()) {
	return normalizeImageDevelopStateCurrentV1({ ...base, masks: [{ schemaVersion: 2, name: 'Paint', id: 'painted', kind: 'matte',
		inputs: [{ name: 'paint', sourceRef: reference.storageKey, kind: 'alpha' }], nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'alpha' }], maskBindings: [] });
}

/** Genuine selected factory/native repositories. Prototype observers only join
 * real native ACK/body outcomes; they neither validate nor replace source bytes. */
export async function repairSettingsFixture(count = 2) {
	assert.ok(Number.isSafeInteger(count) && count >= 1 && count <= 3);
	const native = mediaRestoreFixture(), locks = currentAppLocks(), options = { name: 'Repair settings', indexedDB: native.factory, locks };
	const priorRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const saveDescriptor = Object.getOwnPropertyDescriptor(PhotoCatalogRepositoryCurrentV1.prototype, 'savePhoto');
	const bodyDescriptor = Object.getOwnPropertyDescriptor(PhotoMaskRasterRepositoryV1.prototype, 'withBytes');
	const save = PhotoCatalogRepositoryCurrentV1.prototype.savePhoto, withBytes = PhotoMaskRasterRepositoryV1.prototype.withBytes;
	const hooks = { afterSave: async (_photo: PhotoDocumentCurrentV1): Promise<void> => undefined,
		borrowedBrush: async (_reference: unknown, _bytes: Uint8Array<ArrayBuffer>): Promise<void> => undefined };
	const saved: PhotoDocumentCurrentV1[] = [], borrowed: Uint8Array<ArrayBuffer>[] = [];
	Object.defineProperty(PhotoCatalogRepositoryCurrentV1.prototype, 'savePhoto', { configurable: true, value: async function (this: PhotoCatalogRepositoryCurrentV1, ...args: Parameters<typeof save>) {
		const photo = await Reflect.apply(save, this, args) as PhotoDocumentCurrentV1; saved.push(photo); await hooks.afterSave(photo); return photo;
	} });
	Object.defineProperty(PhotoMaskRasterRepositoryV1.prototype, 'withBytes', { configurable: true, value: function <Result>(this: PhotoMaskRasterRepositoryV1,
		reference: unknown, consume: (bytes: Uint8Array<ArrayBuffer>) => Result | Promise<Result>, options?: Readonly<{ signal?: AbortSignal }>) {
		return Reflect.apply(withBytes, this, [reference, async (bytes: Uint8Array<ArrayBuffer>) => { borrowed.push(bytes); await hooks.borrowedBrush(reference, bytes); return consume(bytes); }, options]) as Promise<Result>;
	} });
	let session: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>> | undefined;
	const live: { media?: PhotoMediaStoreV1; catalog?: PhotoCatalogRepositoryCurrentV1 } = {};
	const restore = () => {
		for (const [target, key, descriptor] of [[globalThis, 'IDBKeyRange', priorRange], [PhotoCatalogRepositoryCurrentV1.prototype, 'savePhoto', saveDescriptor],
			[PhotoMaskRasterRepositoryV1.prototype, 'withBytes', bodyDescriptor]] as const) {
			if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key);
		}
	};
	try {
		const initial = await createPhotoLibrarySessionCurrentV1(options); try { await initial.readPage(); } finally { await initial.close(); }
		const anchor = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, preferOpfs: false });
		let selected: Awaited<ReturnType<typeof readPhotoLibrarySessionLocationV2>>;
		try { await anchor.ready(); selected = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw new Error('Fixture cannot initialize another namespace.'); } }); } finally { await anchor.close(); }
		const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false }); live.media = media;
		const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal,
			verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, { cubeLutResources: () => media.getCubeLutResources(), maskRasterResources: () => media.getMaskRasterResources() }, signal) }); live.catalog = catalog;
		const bytes = pngBytes(ORIGINAL), photos: PhotoDocumentCurrentV1[] = []; await media.ready();
		for (let index = 1; index <= count; index++) {
			const fixture = photoArchiveFixture(index, bytes), legacy = normalizePhotoDocumentV1({ ...fixture.photo, catalogId: selected.location.catalogId,
				original: { ...fixture.photo.original, width: 3, height: 1, hasAlpha: false } });
			const photo = applyPhotoCommandCurrentV1(legacy, index === 1 ? { type: 'record-develop', versionId: legacy.activeVersionId,
				develop: repairRecipe(), label: 'Repairs', createdAt: SETTINGS_TIME } : { type: 'set-develop', develop: defaultImageDevelopStateV2() });
			const asset = await media.mediaRepository.writeAsset(photo.original.storageKey, fixture.original);
			await media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'settings-seed', [{ photoId: photo.id, sourceId: photo.original.id,
				assetId: asset.sourceId, sha256: asset.sha256, size: asset.size }]); photos.push(photo);
		}
		const root = await catalog.loadCatalog(selected.location.catalogId); assert.ok(root); await catalog.publishPhotos(root.id, root.revision, photos);
		await media.mediaRepository.catalogOriginals.promote(root.id, 'settings-seed', photos.map(photo => photo.id));
		await Promise.all([catalog.close(), media.close()]); live.catalog = undefined; live.media = undefined;
		session = await createPhotoLibrarySessionCurrentV1(options); const actual = session;
		const inspect = async () => {
			const media = new PhotoMediaStoreV1({ indexedDB: native.factory, locks, databaseName: selected.location.mediaDatabaseName, preferOpfs: false });
			const catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB: native.factory, databaseName: selected.location.catalogDatabaseName, verifyOriginal: media.verifyOriginal });
			try { return await Promise.all(photos.map(async photo => { const row = await catalog.loadPhoto(photo.catalogId, photo.id); assert.ok(row);
				const body = await media.mediaRepository.loadAsset(row.original.storageKey); assert.ok(body instanceof Blob); return { photo: row, bytes: new Uint8Array(await body.arrayBuffer()) }; })); }
			finally { await Promise.all([catalog.close(), media.close()]); }
		};
		const read = (index = 0) => actual.develop.read({ schemaVersion: 3, photoId: photos[index]!.id });
		const source = (index = 0, draft: ImageDevelopStateCurrentV1 = photos[index]!.versions[0]!.develop) => ({ schemaVersion: 3 as const,
			catalogId: photos[index]!.catalogId, photoId: photos[index]!.id, versionId: photos[index]!.activeVersionId, revision: photos[index]!.revision, develop: draft });
		const execute: ExecutePhotoDevelopCurrentV1 = async (run, external) => { const signal = external ?? new AbortController().signal;
			await run({ signal, acquire: async () => actual.develop, isCurrent: () => true, refresh: () => actual.readPage() }); return 'completed'; };
		return { session: actual, photos, options, native, hooks, saved, borrowed, bytes, read, source, execute, inspect,
			async record(develop: unknown, index = 0) { const before = await read(index); const ack = await actual.develop.apply({ schemaVersion: 3, photoId: before.photoId,
				expectedRevision: before.revision, command: { type: 'record-develop', versionId: before.versionId, develop: normalizeImageDevelopStateCurrentV1(develop), label: 'Settings fixture', createdAt: SETTINGS_TIME } });
				photos[index] = (await inspect())[index]!.photo; return ack; },
			async installBrush(alpha: readonly number[] = [255, 0, 128]) { return withPreparedBrushMaskResourceV1({ width: alpha.length, height: 1, alpha: Uint8Array.from(alpha) },
				body => actual.develop.maskRasters!.install(body.reference, body.bytes)); },
			async corruptBrush(reference: Readonly<BrushMaskResourceReferenceV1>) {
				const opening = native.factory.open(selected.location.mediaDatabaseName), database = await new Promise<IDBDatabase>((resolve, reject) => {
					opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); }; });
				try { await transact(database, 'analysis', 'readwrite', async stores => { const row = await request(stores.analysis!.get(reference.storageKey)) as { value: { bytes: Uint8Array } };
					assert.ok(row); row.value.bytes[16] = row.value.bytes[16]! ^ 1; await request(stores.analysis!.put(row)); }); } finally { database.close(); }
			},
			async close() { try { await actual.close(); } finally { restore(); } },
		};
	} catch (error) { try { await Promise.allSettled([session?.close(), live.catalog?.close(), live.media?.close()]); } finally { restore(); } throw error; }
}
