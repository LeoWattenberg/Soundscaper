/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultPhotoDevelopV1 } from '../../src/lightscaper/catalog/develop-state.ts';
import { emptyPhotoMetadataV1 } from '../../src/lightscaper/catalog/photo-metadata.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import type { PhotoDocumentV1 } from '../../src/lightscaper/catalog/types.ts';
import type { PhotoCatalogPackInput } from '../../src/lightscaper/archive/catalog-pack.ts';
import { importManagedPhotosV1, photoImportIntentKeyV1, recoverManagedPhotoImportV1 } from '../../src/lightscaper/import/managed-import-v1.ts';
import type { PhotoManagedImportPortsV1 } from '../../src/lightscaper/import/managed-import-ports-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { canonicalMediaContentBlob, digestMediaContent, MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../../src/common/editor/storage/media-content-digest.ts';

type Mode = 'dedupe' | 'staged-abort' | 'published-abort' | 'acknowledgement' | 'direct-writer';
type Stage = PhotoManagedImportPortsV1['media']['custody']['stage'];
type Publish = PhotoManagedImportPortsV1['catalog']['publishPhotos'];
type Owners = ReturnType<typeof openOwners>;
interface Fixture {
	readonly names: Readonly<{ media: string; catalog: string }>;
	readonly catalogId: string;
	readonly owner: () => Owners;
	readonly reopen: () => Promise<Owners>;
}

// One valid 1x1 PNG. Original file bytes remain distinct from decoded pixels.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5RkAAAAASUVORK5CYII=';
const expectedBytes = Uint8Array.from(atob(PNG), (character) => character.charCodeAt(0));

export async function qualifyManagedImportNativeV1(mode: Mode): Promise<Readonly<Record<string, unknown>>> {
	if (!['dedupe', 'staged-abort', 'published-abort', 'acknowledgement', 'direct-writer'].includes(mode)) throw new TypeError('Unsupported native import qualification.');
	const nonce = crypto.randomUUID();
	const names = { media: `lightscaper-native-media-${nonce}`, catalog: `lightscaper-native-catalog-${nonce}` };
	const catalogId = `catalog-${nonce}`;
	let owners = openOwners(names);
	const observations = observeInventories(names);
	const fixture: Fixture = { names, catalogId, owner: () => owners, reopen: async () => {
		await owners.close(); owners = openOwners(names); await owners.media.ready(); return owners;
	} };
	try {
		await createCatalog(owners, catalogId);
		const result = mode === 'direct-writer' ? await directWriter(fixture) : mode === 'dedupe' ? await dedupe(fixture)
			: mode === 'acknowledgement' ? await acknowledgement(fixture)
				: await interrupted(fixture, mode);
		return Object.freeze({ ...result, expectedBytes: [...expectedBytes], inventoryCalls: [...observations.calls] });
	} finally {
		await owners.close(); observations.restore();
		await Promise.all([deleteDatabase(names.media), deleteDatabase(names.catalog)]);
	}
}

function openOwners(names: Readonly<{ media: string; catalog: string }>) {
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: names.media, locks: navigator.locks,
		preferOpfs: false, syncWorkerClient: null });
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: names.catalog, verifyOriginal: media.verifyOriginal });
	return { media, catalog, close: async () => { await catalog.close(); await media.close(); } };
}

function ports(owner: Owners, importId = 'import-active', overrides: Readonly<{
	stage?: Stage; publish?: Publish; directWriter?: boolean; directFailure?: (failure: unknown) => void;
}> = {}): PhotoManagedImportPortsV1 {
	const custody = owner.media.mediaRepository.catalogOriginals;
	const directWrite: PhotoManagedImportPortsV1['media']['writeAsset'] = async (...args) => {
		try { return await owner.media.mediaRepository.writeAsset(...args); }
		catch (failure) { overrides.directFailure?.(failure); throw failure; }
	};
	const streamedWrite: PhotoManagedImportPortsV1['media']['writeAsset'] = async (assetId, input, metadata = {}, options = {}) => {
		const original = canonicalMediaContentBlob(input);
		const expectedSha256 = await digestMediaContent(original, { signal: options.signal });
		const writer = await owner.media.mediaRepository.beginAssetWrite(assetId, metadata,
			{ expectedBytes: original.size, expectedSha256, signal: options.signal });
		try {
			for (let offset = 0; offset < original.size; offset += MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
				const bytes = new Uint8Array(await original.slice(offset, offset + MEDIA_CONTENT_DIGEST_CHUNK_BYTES).arrayBuffer());
				await writer.write(bytes, options);
			}
			return await writer.commit(options);
		} catch (failure) {
			try { await writer.abort(); } catch (cleanup) { throw new AggregateError([failure, cleanup], 'Native original write and cleanup failed.', { cause: cleanup }); }
			throw failure;
		}
	};
	return {
		catalog: { loadCatalog: (id) => owner.catalog.loadCatalog(id), loadPhoto: (catalog, photo) => owner.catalog.loadPhoto(catalog, photo),
			publishPhotos: overrides.publish ?? ((...args) => owner.catalog.publishPhotos(...args)) },
		media: { writeAsset: overrides.directWriter ? directWrite : streamedWrite, custody: {
			findDigestPage: (...args) => custody.findDigestPage(...args), stage: overrides.stage ?? ((...args) => custody.stage(...args)),
			readPage: (...args) => custody.readPage(...args), promote: (...args) => custody.promote(...args),
			releaseStaged: (...args) => custody.releaseStaged(...args),
		} },
		journal: owner.media.settingsRepository, createImportId: () => importId,
	};
}

async function createCatalog(owner: Owners, id: string): Promise<void> {
	await owner.catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id, name: 'Native qualification', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
}

async function photoInput(catalogId: string, index: number): Promise<PhotoCatalogPackInput> {
	const digest = await crypto.subtle.digest('SHA-256', expectedBytes);
	const contentSha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
	const name = `Selected original ${index}.png`;
	const photo = normalizePhotoDocumentV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo',
		id: `photo-${index}`, catalogId, revision: 0,
		original: { schemaVersion: 1, kind: 'still', id: `source-${index}`, name, mimeType: 'image/png',
			storageKey: `original-${index}`, contentSha256, width: 1, height: 1, hasAlpha: true,
			byteLength: expectedBytes.byteLength, retention: 'managed' },
		metadata: { ...emptyPhotoMetadataV1(name), caption: index === 1 ? 'First authored caption' : 'Second authored caption' },
		folderId: null, collectionIds: [], keywordIds: [], rating: index === 1 ? 4 : 1,
		flag: 'unflagged', colorLabel: 'none', activeVersionId: `version-${index}`,
		versions: [{ id: `version-${index}`, kind: 'master', name: 'Original',
			createdAt: '2026-10-07T00:00:00.000Z', develop: defaultPhotoDevelopV1() }],
	});
	return { photo, original: new Blob([expectedBytes], { type: 'image/png' }) };
}

async function dedupe(f: Fixture): Promise<Readonly<Record<string, unknown>>> {
	const receipts = await importManagedPhotosV1(f.catalogId, [await photoInput(f.catalogId, 1), await photoInput(f.catalogId, 2)], ports(f.owner()));
	const owner = await f.reopen();
	const photos = [requiredPhoto(await owner.catalog.loadPhoto(f.catalogId, 'photo-1')),
		requiredPhoto(await owner.catalog.loadPhoto(f.catalogId, 'photo-2'))];
	for (const photo of photos) await owner.media.verifyOriginal(photo.original);
	return { receipts, ...await state(f, photos) };
}

async function directWriter(f: Fixture): Promise<Readonly<Record<string, unknown>>> {
	let writerFailure: Readonly<{ name: string; message: string }> | null = null;
	const receipts = await importManagedPhotosV1(f.catalogId, [await photoInput(f.catalogId, 1)], ports(f.owner(), 'import-active', {
		directWriter: true, directFailure: (failure) => { writerFailure = { name: errorName(failure), message: errorMessage(failure) }; },
	}));
	const owner = await f.reopen();
	const photo = await owner.catalog.loadPhoto(f.catalogId, 'photo-1');
	if (photo) return { receipts, ...await state(f, [photo]) };
	const root = await owner.catalog.loadCatalog(f.catalogId);
	const permanent = await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.catalogId });
	const staged = await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.catalogId, importId: 'import-active' });
	return { receipts, writerFailure, photoCount: root?.photoCount, assets: await countRecords(f.names.media, 'mediaAssets'),
		permanentPhotos: permanent.roots.map((root) => root.photoId), stagedPhotos: staged.roots.map((root) => root.photoId),
		intent: await hasIntent(owner, f.catalogId) };
}

async function acknowledgement(f: Fixture): Promise<Readonly<Record<string, unknown>>> {
	const owner = f.owner();
	const publish: Publish = async (...args) => {
		await owner.catalog.publishPhotos(...args);
		const stored = requiredPhoto(await owner.catalog.loadPhoto(f.catalogId, 'photo-1'));
		await owner.catalog.savePhoto(normalizePhotoDocumentV1({ ...stored, rating: 5,
			metadata: { ...stored.metadata, caption: 'Authored after durable publication' } }), stored.revision);
		throw new Error('Injected acknowledgement failure after real catalog commit.');
	};
	const receipts = await importManagedPhotosV1(f.catalogId, [await photoInput(f.catalogId, 1)], ports(owner, 'import-active', { publish }));
	const reopened = await f.reopen();
	const photo = requiredPhoto(await reopened.catalog.loadPhoto(f.catalogId, 'photo-1'));
	return { receipts, ...await state(f, [photo]) };
}

async function interrupted(f: Fixture, mode: 'staged-abort' | 'published-abort'): Promise<Readonly<Record<string, unknown>>> {
	const owner = f.owner();
	const stop = new AbortController();
	const otherCatalogId = `other-${f.catalogId}`;
	let competingRecovery: string | null = null;
	let stagedWhileLocked = 0;
	let intentWhileLocked = false;
	let interruption = '';
	if (mode === 'staged-abort') {
		await createCatalog(owner, otherCatalogId);
		await importManagedPhotosV1(otherCatalogId, [await photoInput(otherCatalogId, 2)], ports(owner, 'import-other'));
		let began!: () => void, resume!: () => void;
		const started = new Promise<void>((resolve) => { began = resolve; });
		const held = new Promise<void>((resolve) => { resume = resolve; });
		const stage: Stage = async (...args) => { await owner.media.mediaRepository.catalogOriginals.stage(...args); began(); await held; };
		const importing = importManagedPhotosV1(f.catalogId, [await photoInput(f.catalogId, 1)], ports(owner, 'import-active', { stage }), { signal: stop.signal });
		const settled = Promise.allSettled([importing]);
		await started;
		const contender = openOwners(f.names);
		try {
			try { await recoverManagedPhotoImportV1(f.catalogId, ports(contender)); competingRecovery = 'unexpected admission'; }
			catch (error) { competingRecovery = errorMessage(error); }
			stagedWhileLocked = (await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.catalogId, importId: 'import-active' })).roots.length;
			intentWhileLocked = await hasIntent(owner, f.catalogId);
		} finally { await contender.close(); stop.abort(); resume(); }
		const [result] = await settled;
		interruption = result?.status === 'rejected' ? errorName(result.reason) : 'unexpected completion';
	} else {
		const publish: Publish = async (...args) => { const root = await owner.catalog.publishPhotos(...args); stop.abort(); return root; };
		try { await importManagedPhotosV1(f.catalogId, [await photoInput(f.catalogId, 1)], ports(owner, 'import-active', { publish }), { signal: stop.signal }); }
		catch (error) { interruption = errorName(error); }
	}
	const reopened = await f.reopen();
	const published = await reopened.catalog.loadPhoto(f.catalogId, 'photo-1');
	const staged = await reopened.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.catalogId, importId: 'import-active' });
	const assetId = staged.roots[0]?.assetId;
	if (!assetId) throw new Error('Interrupted native import lost its original custody.');
	const intentBeforeRecovery = await hasIntent(reopened, f.catalogId);
	const deletionRefusedBeforeRecovery = await deletionRefused(reopened, assetId);
	await recoverManagedPhotoImportV1(f.catalogId, ports(reopened));
	const stagedAfter = await reopened.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.catalogId, importId: 'import-active' });
	const other = await reopened.media.mediaRepository.catalogOriginals.readPage({ catalogId: otherCatalogId });
	const otherPhoto = mode === 'staged-abort' ? requiredPhoto(await reopened.catalog.loadPhoto(otherCatalogId, 'photo-2')) : null;
	return { interruption, competingRecovery, stagedWhileLocked, intentWhileLocked, deletionRefusedBeforeRecovery,
		publishedBeforeRecovery: published !== null, intentBeforeRecovery, stagedBeforeRecovery: staged.roots.length,
		stagedAfterRecovery: stagedAfter.roots.length, otherPermanentPhotos: other.roots.map((root) => root.photoId),
		...await state(f, published ? [published] : [], assetId, otherPhoto) };
}

async function state(f: Fixture, photos: readonly PhotoDocumentV1[], assetId?: string, otherPhoto: PhotoDocumentV1 | null = null) {
	const owner = f.owner();
	const root = await owner.catalog.loadCatalog(f.catalogId);
	const roots = await owner.media.mediaRepository.catalogOriginals.readPage({ catalogId: f.catalogId });
	const storageKey = assetId ?? photos[0]?.original.storageKey;
	if (!storageKey) throw new Error('Native import qualification requires a retained original key.');
	const body = await owner.media.mediaRepository.loadAsset(storageKey);
	if (!body) throw new Error('Original file bytes disappeared across native reopen.');
	if (otherPhoto) await owner.media.verifyOriginal(otherPhoto.original);
	return { photoCount: root?.photoCount, catalogRevision: root?.revision,
		originalIds: photos.map((photo) => photo.original.id), storageKeys: photos.map((photo) => photo.original.storageKey),
		ratings: photos.map((photo) => photo.rating), captions: photos.map((photo) => photo.metadata.caption),
		photoRevisions: photos.map((photo) => photo.revision), permanentPhotos: roots.roots.map((root) => root.photoId).sort(),
		assets: await countRecords(f.names.media, 'mediaAssets'), intent: await hasIntent(owner, f.catalogId),
		deletionRefused: await deletionRefused(owner, storageKey), actualBytes: [...new Uint8Array(await body.arrayBuffer())] };
}

function requiredPhoto(photo: PhotoDocumentV1 | null): PhotoDocumentV1 {
	if (!photo) throw new Error('Published photo disappeared across native reopen.');
	return photo;
}
async function hasIntent(owner: Owners, catalogId: string): Promise<boolean> {
	return await owner.media.settingsRepository.get(photoImportIntentKeyV1(catalogId)) !== undefined;
}
async function deletionRefused(owner: Owners, assetId: string): Promise<boolean> {
	try { await owner.media.mediaRepository.deleteAsset(assetId); return false; }
	catch (error) { if (!errorMessage(error).includes('catalog original')) throw error; return true; }
}
function errorName(error: unknown): string {
	return error instanceof Error || error instanceof DOMException ? error.name : 'Unknown error';
}
function errorMessage(error: unknown): string {
	return error instanceof Error || error instanceof DOMException ? error.message : 'Unknown error';
}

function observeInventories(names: Readonly<{ media: string; catalog: string }>) {
	const calls: string[] = [];
	const descriptor = Object.getOwnPropertyDescriptor(IDBObjectStore.prototype, 'getAll');
	if (!descriptor) throw new Error('Native IndexedDB inventory method is missing.');
	const original = IDBObjectStore.prototype.getAll;
	Object.defineProperty(IDBObjectStore.prototype, 'getAll', { ...descriptor,
		value: function (this: IDBObjectStore, ...args: unknown[]): unknown {
			if ([names.media, names.catalog].includes(this.transaction.db.name)
				&& ['mediaAssets', 'catalogOriginalRoots', 'photos'].includes(this.name)) calls.push(`${this.transaction.db.name}:${this.name}`);
			return Reflect.apply(original, this, args) as unknown;
		} });
	return { calls, restore: () => { Object.defineProperty(IDBObjectStore.prototype, 'getAll', descriptor); } };
}

async function countRecords(databaseName: string, store: string): Promise<number> {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
	try {
		return await new Promise<number>((resolve, reject) => {
			let count = 0;
			const transaction = database.transaction(store);
			const reading = transaction.objectStore(store).count();
			reading.onsuccess = () => { count = reading.result; };
			transaction.oncomplete = () => { resolve(count); }; transaction.onabort = () => { reject(transaction.error); };
		});
	} finally { database.close(); }
}

async function deleteDatabase(name: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const deleting = indexedDB.deleteDatabase(name);
		deleting.onsuccess = () => { resolve(); }; deleting.onerror = () => { reject(deleting.error); };
		deleting.onblocked = () => { reject(new Error('Native fixture cleanup retained a database connection.')); };
	});
}
