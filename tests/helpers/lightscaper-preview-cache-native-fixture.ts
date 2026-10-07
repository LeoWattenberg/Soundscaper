/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { defaultPhotoDevelopV1 } from '../../src/lightscaper/catalog/develop-state.ts';
import { emptyPhotoMetadataV1 } from '../../src/lightscaper/catalog/photo-metadata.ts';
import { PhotoPreviewSchedulerV1 } from '../../src/lightscaper/preview/photo-preview-scheduler-v1.ts';
import { withPhotoOriginalFrameV1 } from '../../src/lightscaper/preview/photo-original-frame-v1.ts';
import { encodePhotoOrientationGridJpegFixtureV1, compareOrientationPixelsV1 } from './lightscaper-photo-orientation-native-fixture.ts';
import { jpegWithExifOrientationV1, permuteExifRgbaV1 } from './lightscaper-photo-orientation-oracle.ts';

/** Real two-database composition; native retained-file decode feeds the durable paired cache. */
export async function qualifyPhotoPreviewCacheNativeV1(mode: 'reopen' | 'fault') {
	const nonce = crypto.randomUUID(), names = { media: `lightscaper-preview-media-${nonce}`, catalog: `lightscaper-preview-catalog-${nonce}` };
	const seed = (await encodePhotoOrientationGridJpegFixtureV1()).jpeg, bytes = jpegWithExifOrientationV1(seed, 6);
	const sha256 = await digest(bytes), input = new File([bytes.slice()], 'Retained-orientation-six.jpg', { type: 'image/jpeg', lastModified: 0 });
	const first = normalizePhotoDocumentV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo', id: 'photo-1',
		catalogId: 'catalog-1', revision: 0,
		original: { schemaVersion: 1, kind: 'still', id: 'logical-original-1', storageKey: 'retained-original',
			name: input.name, mimeType: input.type, contentSha256: sha256, byteLength: bytes.length,
			width: 24, height: 32, hasAlpha: false, retention: 'managed' },
		metadata: { ...emptyPhotoMetadataV1(input.name), orientation: 8 }, folderId: null, collectionIds: [], keywordIds: [],
		rating: 0, flag: 'unflagged', colorLabel: 'none', activeVersionId: 'master',
		versions: [{ id: 'master', kind: 'master', name: 'Original', createdAt: '2026-10-08T00:00:00.000Z', develop: defaultPhotoDevelopV1() }] });
	const second = normalizePhotoDocumentV1({ ...first, id: 'photo-2', original: { ...first.original, id: 'logical-original-2' }, rating: 5 });
	const photos = [first, second], catalogId = first.catalogId;
	const open = () => {
		const media = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, databaseName: names.media,
			preferOpfs: false, syncWorkerClient: null });
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: names.catalog, verifyOriginal: media.verifyOriginal });
		return { media, catalog, close: async () => { await catalog.close(); await media.close(); } };
	};
	let owners = open(), originalReads = 0;
	let scheduler: PhotoPreviewSchedulerV1 | null = null;
	const inventoryCalls: string[] = [], getAll = IDBObjectStore.prototype.getAll, put = IDBObjectStore.prototype.put;
	IDBObjectStore.prototype.getAll = function (...args) {
		if (['mediaAssets', 'videoDerivatives', 'videoDerivativeCacheEntries', 'photoDocuments'].includes(this.name)) {
			inventoryCalls.push(this.name); throw new Error('Preview composition attempted a whole inventory read.');
		}
		return getAll.apply(this, args);
	};
	const createScheduler = () => new PhotoPreviewSchedulerV1({ catalogId,
		loadPhoto: photoId => owners.catalog.loadPhoto(catalogId, photoId),
		loadOriginal: async (key, signal) => { originalReads++; return owners.media.mediaRepository.loadAsset(key, { signal }); },
		cache: owners.media.getPreviewCache() });
	try {
		const sourceWriter = await owners.media.mediaRepository.beginAssetWrite(first.original.storageKey, { mimeType: 'image/jpeg' },
			{ expectedBytes: bytes.length, expectedSha256: sha256 });
		try { await sourceWriter.write(bytes.slice()); await sourceWriter.commit(); }
		catch (error) { await sourceWriter.abort(); throw error; }
		const references = photos.map(photo => ({ photoId: photo.id, assetId: photo.original.storageKey,
			sourceId: photo.original.id, sha256, size: bytes.length }));
		await owners.media.mediaRepository.catalogOriginals.retain(catalogId, references);
		await owners.media.mediaRepository.catalogOriginals.stage(catalogId, 'preserved-import', references);
		await owners.catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: catalogId,
			name: 'Native preview qualification', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await owners.catalog.publishPhotos(catalogId, 0, photos);
		const baseline = await withPhotoOriginalFrameV1({ binding: { catalogId, photoId: 'baseline', originalId: 'baseline', storageKey: 'baseline',
			contentSha256: await digest(seed), byteLength: seed.length, width: 32, height: 24 }, body: new Blob([seed.slice()], { type: 'image/jpeg' }) },
			async frame => new Uint8Array(frame.pixels));
		const oracle = permuteExifRgbaV1(baseline, 32, 24, 6);
		scheduler = createScheduler();
		if (mode === 'fault') IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
			if (['videoDerivatives', 'videoDerivativeCacheEntries'].includes(this.name)) {
				throw new DOMException('Error preparing Blob/File data: injected paired cache failure', 'UnknownError');
			}
			return put.call(this, value, key);
		};
		const firstResult = await scheduler.request({ photoId: first.id, tier: 'thumbnail' });
		IDBObjectStore.prototype.put = put;
		if (firstResult.outcome !== 'ready') throw new Error('Native preview job did not produce a body.');
		const output = new Uint8Array(await firstResult.preview.body.arrayBuffer());
		const failureRows = { payload: await count(names.media, 'videoDerivatives'), inventory: await count(names.media, 'videoDerivativeCacheEntries') };
		if (mode === 'fault') return Object.freeze({ cache: firstResult.cache, persistenceFailure: String(firstResult.persistenceError),
			failureRows, ...compareOrientationPixelsV1(output, oracle.rgba),
			width: firstResult.preview.descriptor.width, height: firstResult.preview.descriptor.height,
			bodyOriginalFree: !Object.hasOwn(firstResult.preview, 'original') && output.length === 24 * 32 * 4,
			...await retainedState(owners, names, photos, bytes), inventoryCalls });
		const secondResult = await scheduler.request({ photoId: second.id, tier: 'thumbnail' });
		if (secondResult.outcome !== 'ready') throw new Error('Second logical photo preview was not prepared.');
		const originalReadsBeforeReopen = originalReads, keys = [firstResult.preview.key, secondResult.preview.key];
		await scheduler.close(); scheduler = null; await owners.close(); owners = open();
		scheduler = createScheduler();
		const reopened = await scheduler.request({ photoId: first.id, tier: 'thumbnail' });
		if (reopened.outcome !== 'ready') throw new Error('Reopened preview was not produced.');
		return Object.freeze({ cache: [firstResult.cache, secondResult.cache], reopenedCache: reopened.cache,
			keys, originalReadsBeforeReopen, originalReadsAfterReopen: originalReads,
			...compareOrientationPixelsV1(output, oracle.rgba), reopenedPixelsEqual: equal(output, new Uint8Array(await reopened.preview.body.arrayBuffer())),
			width: reopened.preview.descriptor.width, height: reopened.preview.descriptor.height,
			bodyOriginalFree: !Object.hasOwn(reopened.preview, 'original') && output.length === 24 * 32 * 4,
			...await retainedState(owners, names, photos, bytes), inventoryCalls });
	} finally {
		IDBObjectStore.prototype.put = put; IDBObjectStore.prototype.getAll = getAll;
		await scheduler?.close(); await owners.close();
		await Promise.all([removeDatabase(names.media), removeDatabase(names.catalog)]);
	}
}

async function retainedState(owners: { media: PhotoMediaStoreV1; catalog: PhotoCatalogRepositoryV1 }, names: { media: string },
	photos: ReturnType<typeof normalizePhotoDocumentV1>[], bytes: Uint8Array) {
	const first = photos[0]!;
	const roots = await owners.media.mediaRepository.catalogOriginals.readPage({ catalogId: first.catalogId });
	const stages = await owners.media.mediaRepository.catalogOriginals.readPage({ catalogId: first.catalogId, importId: 'preserved-import' });
	const current = await Promise.all(photos.map(photo => owners.catalog.loadPhoto(photo.catalogId, photo.id)));
	const original = await owners.media.mediaRepository.loadAsset(first.original.storageKey);
	let deletionRefused = false;
	try { await owners.media.mediaRepository.deleteAsset(first.original.storageKey); }
	catch (error) { deletionRefused = /catalog original/u.test(String(error)); }
	return { originalBytesEqual: original instanceof Blob && equal(bytes, new Uint8Array(await original.arrayBuffer())),
		photoStatesEqual: JSON.stringify(current) === JSON.stringify(photos), permanentPhotos: roots.roots.map(root => root.photoId),
		stagedPhotos: stages.roots.map(root => root.photoId), assets: await count(names.media, 'mediaAssets'), deletionRefused };
}

async function count(databaseName: string, store: string): Promise<number> {
	const database = await openDatabase(databaseName);
	try { return await new Promise<number>((resolve, reject) => {
		const transaction = database.transaction(store, 'readonly'), request = transaction.objectStore(store).count();
		request.onsuccess = () => { resolve(request.result); }; request.onerror = () => { reject(request.error); };
	}); } finally { database.close(); }
}
function openDatabase(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => { const request = indexedDB.open(name);
		request.onsuccess = () => { resolve(request.result); }; request.onerror = () => { reject(request.error); };
	});
}
function removeDatabase(name: string): Promise<void> {
	return new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => { resolve(); }; request.onerror = () => { reject(request.error); };
	});
}
async function digest(bytes: Uint8Array): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function equal(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
