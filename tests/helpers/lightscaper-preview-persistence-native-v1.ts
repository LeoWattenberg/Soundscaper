/* SPDX-License-Identifier: AGPL-3.0-only */

import { BinaryDerivativeCacheRepositoryV1 } from '../../src/common/editor/storage/binary-derivative-cache-repository.ts';
import { readBinaryDerivativeCacheRecordV1 } from '../../src/common/editor/storage/binary-derivative-cache-records.ts';
import { openDatabase, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { MediaAssetLifecycleCoordinator } from '../../src/common/editor/storage/media-asset-lifecycle-coordinator.ts';
import { getMemoryDatabase } from '../../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository, type OpfsBinaryWriter } from '../../src/common/editor/storage/opfs-repository.ts';
import { defaultPhotoDevelopV1 } from '../../src/lightscaper/catalog/develop-state.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { emptyPhotoMetadataV1 } from '../../src/lightscaper/catalog/photo-metadata.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { withPhotoOriginalFrameV1 } from '../../src/lightscaper/preview/photo-original-frame-v1.ts';
import { PhotoPreviewCacheV1, PHOTO_PREVIEW_CACHE_PROFILE_V1, type PhotoPreviewCachePortV1 } from '../../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { planPhotoPreviewV1 } from '../../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { PhotoPreviewSchedulerV1 } from '../../src/lightscaper/preview/photo-preview-scheduler-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { compareOrientationPixelsV1, encodePhotoOrientationGridJpegFixtureV1 } from './lightscaper-photo-orientation-native-fixture.ts';
import { jpegWithExifOrientationV1, permuteExifRgbaV1 } from './lightscaper-photo-orientation-oracle.ts';

export type PhotoPreviewPersistenceCutV1 = 'after-write' | 'after-close' | 'payload-put' | 'inventory-put' | 'completed-ack' | 'cleanup-ack';
const PAYLOAD = 'videoDerivatives', INVENTORY = 'videoDerivativeCacheEntries';
const PROFILE = PHOTO_PREVIEW_CACHE_PROFILE_V1;

interface NativeCut {
	readonly kind: PhotoPreviewPersistenceCutV1;
	readonly stop: AbortController;
	readonly reason: Error;
	readonly cleanupFailure: Error;
	armed: boolean;
	fired: boolean;
	path: string | null;
	oldPath: string | null;
	writeBytes: number;
	closedSha256: string | null;
	putSuccesses: string[];
	completed: number;
	aborted: number;
	deletedPath: string | null;
}

/** Native asynchronous OPFS and IDB only; this does not qualify the sync worker or selected-store Close composition. */
export async function qualifyPhotoPreviewPersistenceNativeV1(kind: PhotoPreviewPersistenceCutV1) {
	const nonce = crypto.randomUUID(), names = { media: `lightscaper-preview-cuts-media-${nonce}`,
		catalog: `lightscaper-preview-cuts-catalog-${nonce}`, directory: `lightscaper-preview-cuts-${nonce}` };
	const cut: NativeCut = { kind, stop: new AbortController(), reason: new Error(`Native preview cut: ${kind}`),
		cleanupFailure: new Error('Native deletion completed; injected cleanup acknowledgement loss.'), armed: false, fired: false,
		path: null, oldPath: null, writeBytes: 0, closedSha256: null, putSuccesses: [], completed: 0, aborted: 0, deletedPath: null };
	const seed = (await encodePhotoOrientationGridJpegFixtureV1()).jpeg, bytes = jpegWithExifOrientationV1(seed, 6), originalSha256 = await digest(bytes);
	const photo = photoDocument(bytes.length, originalSha256), binding = { catalogId: photo.catalogId, photoId: photo.id,
		originalId: photo.original.id, storageKey: photo.original.storageKey, contentSha256: originalSha256,
		byteLength: bytes.length, width: photo.original.width, height: photo.original.height };
	// Failure to obtain native OPFS is a failure, never a successful Blob fallback or a capability skip.
	const root = await navigator.storage.getDirectory(), directory = await root.getDirectoryHandle(names.directory, { create: true });
	let owners = openOwners(), database: IDBDatabase | null = null, binary: OpfsRepository | null = null;
	let scheduler: PhotoPreviewSchedulerV1 | null = null, originalReads = 0;
	let primaryFailed = false, primaryFailure: unknown;
	try {
		const writer = await owners.media.mediaRepository.beginAssetWrite(photo.original.storageKey, { mimeType: 'image/jpeg' },
			{ expectedBytes: bytes.length, expectedSha256: originalSha256 });
		try { await writer.write(bytes.slice()); await writer.commit(); } catch (error) { await writer.abort(); throw error; }
		const references = [{ photoId: photo.id, assetId: photo.original.storageKey, sourceId: photo.original.id, sha256: originalSha256, size: bytes.length }];
		await owners.media.mediaRepository.catalogOriginals.retain(photo.catalogId, references);
		await owners.media.mediaRepository.catalogOriginals.stage(photo.catalogId, 'preserved-import', references);
		await owners.catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: photo.catalogId,
			name: 'Native preview interruption qualification', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await owners.catalog.publishPhotos(photo.catalogId, 0, [photo]);
		const originalBefore = await owners.media.mediaRepository.getAssetMetadata(photo.original.storageKey);
		if (originalBefore?.storage !== 'opfs' || typeof originalBefore.path !== 'string') throw new Error('Retained native original fell back from OPFS.');
		const originalPath = originalBefore.path, nativeOriginalSha256 = await fileDigest(directory, originalPath);
		const baseline = await withPhotoOriginalFrameV1({ binding: { ...binding, photoId: 'baseline', originalId: 'baseline', storageKey: 'baseline',
			contentSha256: await digest(seed), byteLength: seed.length, width: 32, height: 24 }, body: new Blob([seed.slice()], { type: 'image/jpeg' }) },
			async frame => new Uint8Array(frame.pixels));
		const oracle = permuteExifRgbaV1(baseline, 32, 24, 6);
		const original = await owners.media.mediaRepository.loadAsset(photo.original.storageKey); originalReads++;
		const prepared = await withPhotoOriginalFrameV1({ binding, body: original }, frame => {
			const plan = planPhotoPreviewV1({ binding, source: frame.descriptor, tier: 'thumbnail' });
			return preparePhotoPreviewV1({ plan, binding, frame });
		});
		const pixels = new Uint8Array(await prepared.body.arrayBuffer());
		database = await openDatabase(indexedDB, names.media); binary = openBinary();
		const lifecycle = new MediaAssetLifecycleCoordinator(), wrapped = observeDatabase(database, cut);
		const cache = createCache(wrapped, observeBinary(binary, directory, cut), lifecycle);
		const committed = kind === 'completed-ack' || kind === 'cleanup-ack';
		let previousToken: string | null = null;
		if (kind === 'cleanup-ack') {
			const initial = await cache.store(prepared);
			if (initial.outcome !== 'stored') throw new Error('Initial native pair was not stored.');
			const pair = await readStoredPair(database, prepared.key); cut.oldPath = pair.path; previousToken = pair.cacheToken;
		}
		cut.armed = true;
		let receipt: Awaited<ReturnType<PhotoPreviewCacheV1['store']>> | null = null, refusal: unknown;
		try { receipt = await cache.store(prepared, cut.stop.signal); } catch (error) { refusal = error; }
		cut.armed = false;
		if (!cut.fired || !cut.path) throw new Error('The requested actual native persistence boundary was not reached.');
		if (committed ? receipt?.outcome !== 'stored' : refusal === undefined) throw new Error('Native cut disagrees with its publication contract.');
		const afterCut = await snapshot(database, directory, prepared.key, cut.path);
		const lifecycleReleased = lifecycle.activePaths().size === 0;
		const cleanupErrorsExact = kind === 'cleanup-ack'
			? receipt?.cleanupErrors?.length === 1 && receipt.cleanupErrors[0] === cut.cleanupFailure
			: receipt === null || receipt.cleanupErrors === undefined;
		const exactCancellation = (kind === 'after-write' || kind === 'after-close') ? refusal === cut.reason : null;
		const replaced = previousToken === null ? null : afterCut.pair?.cacheToken !== previousToken && afterCut.pair?.path !== cut.oldPath;
		await closeConnections(); owners = openOwners();
		database = await openDatabase(indexedDB, names.media); binary = openBinary();
		const reopenedPair = await snapshot(database, directory, prepared.key, cut.path);
		scheduler = createScheduler(createCache(database, binary, new MediaAssetLifecycleCoordinator()));
		const reopened = await ready(scheduler), reopenedPixels = new Uint8Array(await reopened.preview.body.arrayBuffer());
		const readsAfterReopen = originalReads;
		const regeneratedPair = await readStoredPair(database, prepared.key);
		const regeneratedNativeSha256 = await fileDigest(directory, requiredPath(regeneratedPair.path));
		await scheduler.close(); scheduler = null;
		// Real bounded eviction makes the body disposable; another complete reopen must regenerate from the immutable original.
		const trimCore = new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(names.media), database: async () => database },
			binary, new MediaAssetLifecycleCoordinator(), { ...PROFILE, maximumEntries: 0 });
		const trimmed = await trimCore.trim(), afterTrim = await snapshot(database, directory, prepared.key, requiredPath(regeneratedPair.path));
		await closeConnections(); owners = openOwners();
		database = await openDatabase(indexedDB, names.media); binary = openBinary();
		scheduler = createScheduler(createCache(database, binary, new MediaAssetLifecycleCoordinator()));
		const regenerated = await ready(scheduler), finalPair = await readStoredPair(database, prepared.key);
		const originalAfter = await owners.media.mediaRepository.getAssetMetadata(photo.original.storageKey);
		const retained = await owners.media.mediaRepository.loadAsset(photo.original.storageKey);
		const permanent = await owners.media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
		const staged = await owners.media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId, importId: 'preserved-import' });
		let deletionRefused = false;
		try { await owners.media.mediaRepository.deleteAsset(photo.original.storageKey); } catch (error) { deletionRefused = /catalog original/u.test(String(error)); }
		return { kind, directSharedLifecycle: true, asyncNativeOpfs: true, workerQualified: false,
			cut: { fired: cut.fired, aborted: cut.stop.signal.aborted, writeBytes: cut.writeBytes, closedSha256: cut.closedSha256,
				putSuccesses: cut.putSuccesses, completed: cut.completed, transactionAborts: cut.aborted, deletedPath: cut.deletedPath },
			receipt: receipt?.outcome ?? null, refusal: refusal === undefined ? null : String(refusal), exactCancellation, cleanupErrorsExact,
			cleanupErrorCount: receipt?.cleanupErrors?.length ?? 0, lifecycleReleased, replaced, afterCut, reopenedPair,
			oldPathAbsent: cut.oldPath === null ? null : !await pathExists(directory, cut.oldPath),
			reopenedCache: reopened.cache, readsAfterReopen, originalReads, regeneratedCache: regenerated.cache,
			reopenedPixelsExact: equal(pixels, reopenedPixels), regeneratedPixelsExact: equal(pixels, new Uint8Array(await regenerated.preview.body.arrayBuffer())),
			width: prepared.descriptor.width, height: prepared.descriptor.height, ...compareOrientationPixelsV1(pixels, oracle.rgba),
			previewSha256: prepared.outputSha256, regeneratedNativeSha256, finalNativeSha256: await fileDigest(directory, requiredPath(finalPair.path)),
			trimmed, afterTrim, originalSha256, nativeOriginalSha256,
			originalMetadataExact: JSON.stringify(originalBefore) === JSON.stringify(originalAfter), originalPathExact: originalAfter?.path === originalPath,
			originalBytesExact: retained instanceof Blob && equal(bytes, new Uint8Array(await retained.arrayBuffer())),
			originalShaExact: retained instanceof Blob && await digest(new Uint8Array(await retained.arrayBuffer())) === originalSha256
				&& await fileDigest(directory, originalPath) === originalSha256,
			photoStateExact: JSON.stringify(await owners.catalog.loadPhoto(photo.catalogId, photo.id)) === JSON.stringify(photo),
			permanentPhotos: permanent.roots.map(item => item.photoId), stagedPhotos: staged.roots.map(item => item.photoId), deletionRefused,
			assets: await transact(database, 'mediaAssets', 'readonly', stores => request(requiredStore(stores, 'mediaAssets').count())) };
	} catch (error) {
		primaryFailed = true; primaryFailure = error; throw error;
	} finally {
		await cleanupFixture();
	}

	async function cleanupFixture() {
		cut.armed = false;
		const failures: unknown[] = [];
		try { await closeConnections(); } catch (error) { failures.push(error); }
		const cleanup = await Promise.allSettled([removeDatabase(names.media), removeDatabase(names.catalog), root.removeEntry(names.directory, { recursive: true })]);
		for (const result of cleanup) if (result.status === 'rejected') failures.push(result.reason);
		if (failures.length) throw new AggregateError([...(primaryFailed ? [primaryFailure] : []), ...failures],
			'Native preview fixture cleanup failed.', primaryFailed ? { cause: primaryFailure } : undefined);
	}

	function openOwners() {
		const media = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, databaseName: names.media,
			preferOpfs: true, opfsRoot: root, opfsDirectoryName: names.directory, syncWorkerClient: null });
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB, databaseName: names.catalog, verifyOriginal: media.verifyOriginal });
		return { media, catalog };
	}
	function openBinary() { return new OpfsRepository({ preferOpfs: true, opfsRoot: root, opfsDirectoryName: names.directory, syncWorkerClient: null }); }
	function createCache(connection: IDBDatabase, port: Pick<OpfsRepository, 'planBinaryWriter' | 'loadBinaryRecord' | 'deletePath'>, lifecycle: MediaAssetLifecycleCoordinator) {
		const core = new BinaryDerivativeCacheRepositoryV1({ memory: getMemoryDatabase(names.media), database: async () => connection }, port, lifecycle, PROFILE);
		const cache = new PhotoPreviewCacheV1(Object.freeze({ load: core.load.bind(core), store: core.store.bind(core), trim: core.trim.bind(core) }));
		return Object.freeze({ load: cache.load.bind(cache), store: cache.store.bind(cache), trim: cache.trim.bind(cache) });
	}
	function createScheduler(cache: PhotoPreviewCachePortV1) {
		return new PhotoPreviewSchedulerV1({ catalogId: photo.catalogId, loadPhoto: photoId => owners.catalog.loadPhoto(photo.catalogId, photoId),
			loadOriginal: async (key, signal) => { originalReads++; return owners.media.mediaRepository.loadAsset(key, { signal }); }, cache });
	}
	async function ready(active: PhotoPreviewSchedulerV1) {
		const result = await active.request({ photoId: photo.id, tier: 'thumbnail' });
		if (result.outcome !== 'ready') throw new Error('Native original scheduler did not deliver the current preview.');
		return result;
	}
	async function closeConnections() {
		const failures: unknown[] = [];
		try { await scheduler?.close(); } catch (error) { failures.push(error); } finally { scheduler = null; }
		try { binary?.close(); } catch (error) { failures.push(error); } finally { binary = null; }
		try { database?.close(); } catch (error) { failures.push(error); } finally { database = null; }
		const closed = await Promise.allSettled([owners.catalog.close(), owners.media.close()]);
		for (const result of closed) if (result.status === 'rejected') failures.push(result.reason);
		if (failures.length) throw new AggregateError(failures, 'Native preview fixture owners did not close cleanly.');
	}
}

function observeBinary(binary: OpfsRepository, directory: FileSystemDirectoryHandle, cut: NativeCut): Pick<OpfsRepository, 'planBinaryWriter' | 'loadBinaryRecord' | 'deletePath'> {
	return {
		async planBinaryWriter(...args) {
			const plan = await binary.planBinaryWriter(...args);
			if (!plan) throw new Error('Native OPFS staging plan was unavailable.');
			if (cut.armed) cut.path = plan.path;
			return { path: plan.path, open: async () => {
				const writer = await plan.open(); if (!writer) throw new Error('Native OPFS writer was unavailable.');
				return { path: writer.path,
					write: async (...writeArgs: Parameters<OpfsBinaryWriter['write']>) => { await writer.write(...writeArgs); if (cut.armed) { cut.writeBytes += writeArgs[0].byteLength; fire(cut, 'after-write'); } },
					close: async (...closeArgs: Parameters<OpfsBinaryWriter['close']>) => { await writer.close(...closeArgs); if (cut.armed) { cut.closedSha256 = await fileDigest(directory, writer.path); fire(cut, 'after-close'); } },
					abort: () => writer.abort() };
			} };
		},
		loadBinaryRecord: (...args) => binary.loadBinaryRecord(...args),
		async deletePath(path) {
			await binary.deletePath(path);
			if (path && await pathExists(directory, path)) throw new Error('Native OPFS deletion left a path present.');
			if (cut.armed && cut.kind === 'cleanup-ack' && path === cut.oldPath) {
				cut.deletedPath = path ?? null; fire(cut, 'cleanup-ack'); throw cut.cleanupFailure;
			}
		},
	};
}

/** Instance-local facades forward real native requests/events and retain every borrowed method receiver. */
function observeDatabase(database: IDBDatabase, cut: NativeCut): IDBDatabase {
	return forwardNative(database, key => key !== 'transaction' ? undefined : (...args: Parameters<IDBDatabase['transaction']>) => {
		const transaction = database.transaction(...args);
		if (!cut.armed || transaction.mode !== 'readwrite' || !transaction.objectStoreNames.contains(PAYLOAD) || !transaction.objectStoreNames.contains(INVENTORY)) return transaction;
		transaction.addEventListener('complete', () => { cut.completed++; fire(cut, 'completed-ack'); }, { once: true });
		transaction.addEventListener('abort', () => { cut.aborted++; }, { once: true });
		return forwardNative(transaction, property => property !== 'objectStore' ? undefined : (name: string) => {
			const store = transaction.objectStore(name);
			if (name !== PAYLOAD && name !== INVENTORY) return store;
			return forwardNative(store, method => method !== 'put' ? undefined : (...putArgs: Parameters<IDBObjectStore['put']>) => {
				const nativeRequest = store.put(...putArgs);
				nativeRequest.addEventListener('success', () => {
					cut.putSuccesses.push(name);
					if (!cut.fired && name === (cut.kind === 'payload-put' ? PAYLOAD : cut.kind === 'inventory-put' ? INVENTORY : null)) {
						cut.fired = true; transaction.abort();
					}
				}, { once: true });
				return nativeRequest;
			});
		});
	});
}

function forwardNative<Value extends object>(target: Value, replace: (key: string | symbol) => unknown): Value {
	return new Proxy(target, {
		get(native, key) {
			const replacement = replace(key); if (replacement !== undefined) return replacement;
			const value: unknown = Reflect.get(native, key, native);
			const forwarded: unknown = typeof value === 'function' ? value.bind(native) : value;
			return forwarded;
		},
		set: (native, key, value: unknown) => Reflect.set(native, key, value, native),
	});
}

function fire(cut: NativeCut, kind: PhotoPreviewPersistenceCutV1): void {
	if (!cut.armed || cut.fired || cut.kind !== kind) return;
	cut.fired = true; cut.stop.abort(cut.reason);
}

async function readPair(database: IDBDatabase, key: string) {
	return transact(database, [PAYLOAD, INVENTORY], 'readonly', async stores => {
		const payload: unknown = await request(requiredStore(stores, PAYLOAD).get(key));
		const inventory: unknown = await request(requiredStore(stores, INVENTORY).get(key));
		if (payload === undefined && inventory === undefined) return null;
		const first = readBinaryDerivativeCacheRecordV1(payload, key, PROFILE, true), second = readBinaryDerivativeCacheRecordV1(inventory, key, PROFILE);
		if (first.storage !== 'opfs' || second.storage !== 'opfs' || !first.path || JSON.stringify(first) !== JSON.stringify(second)) {
			throw new Error('Native pair was absent, mismatched or fell back from OPFS.');
		}
		return { storage: first.storage, path: first.path, cacheToken: first.cacheToken, outputSha256: first.outputSha256, size: first.size };
	});
}

async function snapshot(database: IDBDatabase, directory: FileSystemDirectoryHandle, key: string, path: string) {
	const counts = await transact(database, [PAYLOAD, INVENTORY], 'readonly', async stores => ({
		payload: await request(requiredStore(stores, PAYLOAD).count()), inventory: await request(requiredStore(stores, INVENTORY).count()) }));
	const pair = await readPair(database, key), pathPresent = await pathExists(directory, path);
	return { ...counts, pair, pathPresent, nativeFileSha256: pathPresent ? await fileDigest(directory, path) : null };
}

async function readStoredPair(database: IDBDatabase, key: string) {
	const pair = await readPair(database, key); if (!pair) throw new Error('Native fixture requires an acknowledged pair.'); return pair;
}

function requiredStore(stores: Readonly<Record<string, IDBObjectStore>>, name: string): IDBObjectStore {
	const store = stores[name]; if (!store) throw new Error('Native fixture transaction omitted its required store.'); return store;
}
function requiredPath(path: string | null): string { if (!path) throw new Error('Native fixture requires a real OPFS path.'); return path; }
async function pathExists(directory: FileSystemDirectoryHandle, path: string): Promise<boolean> {
	try { await directory.getFileHandle(path); return true; }
	catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return false; throw error; }
}
async function fileDigest(directory: FileSystemDirectoryHandle, path: string): Promise<string> {
	return digest(new Uint8Array(await (await (await directory.getFileHandle(path)).getFile()).arrayBuffer()));
}
async function digest(bytes: Uint8Array): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()))].map(value => value.toString(16).padStart(2, '0')).join('');
}
function equal(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
function removeDatabase(name: string): Promise<void> {
	return new Promise((resolve, reject) => { const opening = indexedDB.deleteDatabase(name);
		opening.onsuccess = () => { resolve(); }; opening.onerror = () => { reject(opening.error); }; });
}
function photoDocument(byteLength: number, contentSha256: string) {
	return normalizePhotoDocumentV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo', id: 'photo-1', catalogId: 'catalog-1', revision: 0,
		original: { schemaVersion: 1, kind: 'still', id: 'original-1', storageKey: 'retained-original', name: 'Native-orientation-six.jpg',
			mimeType: 'image/jpeg', contentSha256, byteLength, width: 24, height: 32, hasAlpha: false, retention: 'managed' },
		metadata: { ...emptyPhotoMetadataV1('Native-orientation-six.jpg'), orientation: 8 }, folderId: null, collectionIds: [], keywordIds: [],
		rating: 4, flag: 'unflagged', colorLabel: 'none', activeVersionId: 'master',
		versions: [{ id: 'master', kind: 'master', name: 'Original', createdAt: '2026-10-08T00:00:00.000Z', develop: defaultPhotoDevelopV1() }] });
}
