/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2 } from '../../../src/lightscaper/storage/photo-library-location-v2.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { readRepairPresetsCustodyNativeV1 as readOpfsPresetCustody } from './lightscaper-repair-presets-reference.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { createPhotoCatalogArchiveReachabilityCurrentV1 } from '../../../src/lightscaper/archive/catalog-archive-reachability-current-v1.ts';
import { photoDevelopPresetsKeyV1 } from '../../../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { photoDevelopPresetEntryValue } from '../../../src/lightscaper/storage/photo-develop-preset-read-v2.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../../../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { verifyPhotoResourcesCurrentV1, verifyPhotoResourceReferencesCurrentV1 } from '../../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { normalizeCatalogOriginalRoot } from '../../../src/common/editor/storage/media-catalog-original-schema.ts';
import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE, MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../../../src/common/editor/storage/media-asset-chunk-schema.ts';
export { readRepairPresetRowNativeV1 } from './lightscaper-repair-presets-reference.ts';

/** Preserve the independent donor OPFS proof. Fresh allocated restores retain
 * streamed IDB chunks, authenticated here through separate native point reads. */
export async function readRepairPresetsCustodyNativeV1(photoIds: readonly string[], beforeClose?: () => Promise<void>) {
	const first = await readRepairPortableLocationNativeV1();
	if (first.location.namespaceToken === null) return readOpfsPresetCustody(photoIds, beforeClose);
	check(photoIds.length === 2 && new Set(photoIds).size === 2, 'Portable fixture requires exactly two distinct Photos.');
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryCurrentV1 | null = null;
	let result: Awaited<ReturnType<typeof observe>> | undefined, failed = false, failure: unknown;
	async function observe() {
		await anchor.ready(); const selected = await selection();
		check(JSON.stringify(selected.pointer) === JSON.stringify(first.pointer), 'Portable selected namespace changed before observation.');
		check(selected.allocation !== null, 'Portable IDB observer requires a genuine allocated namespace.');
		media = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, databaseName: selected.location.mediaDatabaseName,
			preferOpfs: false, syncWorkerClient: null }); await media.ready();
		const owner = media, resources = { cubeLutResources: () => owner.getCubeLutResources(), maskRasterResources: () => owner.getMaskRasterResources() };
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selected.location.catalogDatabaseName,
			verifyOriginal: owner.verifyOriginal, verifyResources: (photo, signal) => verifyPhotoResourcesCurrentV1(photo, resources, signal) });
		const root = await catalog.loadCatalog(selected.location.catalogId);
		check(root !== null && root.photoCount === photoIds.length, 'Portable catalog inventory differs from the complete fixture.');
		const key = photoDevelopPresetsKeyV1(root.id);
		async function readRow() {
			const value = photoDevelopPresetEntryValue(await owner.settingsRepository.readEntry(key));
			return value === undefined ? null : normalizePhotoDevelopPresetRowCurrentV1(value, root!.id);
		}
		const row = await readRow(), closure = createPhotoCatalogArchiveReachabilityCurrentV1();
		if (row !== null) closure.addPresetRow(row, root.id);
		const documents = [];
		for (const photoId of photoIds) {
			const photo = await catalog.loadPhoto(root.id, photoId); check(photo !== null, 'Portable Current Photo missing.');
			closure.addPhoto(photo); documents.push(photo);
		}
		const references = closure.finish(); await verifyPhotoResourceReferencesCurrentV1(references, resources);
		const native = await readPortableNativeOriginals(selected.location.mediaDatabaseName, photoIds.length);
		const publicPage = await owner.mediaRepository.catalogOriginals.readPage({ catalogId: root.id });
		const roots = native.rows.map(normalizeCatalogOriginalRoot), publicRoots = publicPage.roots.map(normalizeCatalogOriginalRoot);
		check(roots.length === photoIds.length && publicRoots.length === photoIds.length && publicPage.afterKey === null
			&& JSON.stringify(roots) === JSON.stringify(publicRoots), 'Portable native/public complete Original custody differs.');
		check(roots.every(value => value.catalogId === root.id && value.importId === null && photoIds.includes(value.photoId)), 'Portable Original inventory is not permanent and exact.');
		const photos = [];
		for (const photo of documents) {
			await owner.verifyOriginal(photo.original);
			const metadata = await owner.mediaRepository.getAssetMetadata(photo.original.storageKey), record = native.records.find(value => value.sourceId === photo.original.storageKey);
			check(metadata !== null && record !== undefined && metadata.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE
				&& record.storage === MEDIA_ASSET_CHUNK_STORAGE_TYPE, 'Restored Original requires actual native streamed IDB chunk custody.');
			check(metadata.sourceId === photo.original.storageKey && metadata.sha256 === photo.original.contentSha256 && metadata.size === photo.original.byteLength
				&& record.sha256 === photo.original.contentSha256 && record.size === photo.original.byteLength, 'Portable native Original metadata differs from the complete Photo.');
			check(photo.original.byteLength <= 4096, 'Portable Original exceeds the fixture observer bound.');
			const nativeBody = nativeOriginalChunkBlob(record, native.chunks), body = await owner.mediaRepository.loadAsset(photo.original.storageKey);
			check(body !== null && body.size === nativeBody.size && body.size === photo.original.byteLength, 'Portable native/loaded Original body lengths differ.');
			const sha256 = await digestMediaContent(body, { chunkBytes: 4096 });
			check(sha256 === photo.original.contentSha256 && await digestMediaContent(nativeBody, { chunkBytes: 4096 }) === sha256, 'Portable native/loaded Original body digests differ.');
			const permanent = roots.filter(value => value.photoId === photo.id), visible = publicRoots.filter(value => value.photoId === photo.id);
			const retained = permanent[0], token = record.mediaContentToken;
			check(permanent.length === 1 && visible.length === 1 && typeof token === 'string' && retained?.assetId === photo.original.storageKey
				&& retained.sourceId === photo.original.id && retained.sha256 === sha256 && retained.size === body.size && retained.mediaContentToken === token, 'Portable Original permanent custody binding differs.');
			check(Object.values(record).every(value => value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean'
				|| typeof value === 'number' && Number.isFinite(value)), 'Portable native chunk asset record hides a binary value.');
			photos.push({ photo, original: { metadata, mediaContentToken: token, recordJson: JSON.stringify(record), roots: permanent, publicRoots: visible, sha256, byteLength: body.size } });
		}
		const masks = await owner.getMaskRasterResources(), cubes = await owner.getCubeLutResources(), bodies = [], luts = [];
		for (const reference of references.brushes) {
			check(reference.width * reference.height <= 4096, 'Portable brush exceeds its observer bound.');
			bodies.push(await masks.source.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		}
		for (const reference of references.luts) {
			check(reference.byteLength <= 4096, 'Portable LUT exceeds its observer bound.');
			luts.push(await cubes.source.withBytes(reference, bytes => ({ reference, bytes: Array.from(bytes) })));
		}
		check(JSON.stringify(await readRow()) === JSON.stringify(row), 'Portable preset row changed during body observation.');
		check(JSON.stringify((await selection()).pointer) === JSON.stringify(selected.pointer), 'Portable selected namespace changed during body observation.');
		return { namespace: selected.location.namespaceToken, photos, row, bodies, luts };
	}
	function selection() { return withPhotoLibraryInitializationLockV1(navigator.locks,
		() => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw Error('Portable observer cannot initialize a library.'); } })); }
	try { result = await observe(); } catch (error) { failed = true; failure = error; }
	const owners = new Set<PhotoCatalogRepositoryCurrentV1 | PhotoMediaStoreV1 | null>([catalog, media, anchor]);
	const outcomes = await Promise.allSettled([...owners].filter(owner => owner !== null).map(owner => owner.close()));
	const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
	if (failed && !errors.length) throw failure;
	if (errors.length) throw new AggregateError(failed ? [failure, ...errors] : errors, 'Portable custody or joined cleanup failed.', failed ? { cause: failure } : undefined);
	check(result !== undefined, 'Portable custody observation did not complete.'); return result;
}

async function readPortableNativeOriginals(databaseName: string, count: number) {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.addEventListener('upgradeneeded', () => { opening.transaction?.abort(); }, { once: true });
		opening.addEventListener('success', () => { resolve(opening.result); }, { once: true });
		opening.addEventListener('error', () => { reject(opening.error); }, { once: true });
	});
	try {
		return await transact(database, ['mediaAssets', 'catalogOriginalRoots', 'mediaAssetChunks'], 'readonly', async stores => {
			const assets = stores.mediaAssets, roots = stores.catalogOriginalRoots, chunkStore = stores.mediaAssetChunks;
			check(assets !== undefined && roots !== undefined && chunkStore !== undefined, 'Portable native Original stores missing.');
			const rows: unknown[] = await request(roots.getAll(undefined, count + 1)), records: Record<string, unknown>[] = [], chunks: Record<string, unknown>[] = [];
			check(await request(assets.count()) === count, 'Portable physical Original asset inventory differs.');
			check(await request(chunkStore.count()) === count, 'Portable small fixture requires exactly one physical chunk per Original.');
			for (const value of rows) {
				const retained = normalizeCatalogOriginalRoot(value), record: unknown = await request(assets.get(retained.assetId));
				check(record !== null && typeof record === 'object' && !Array.isArray(record), 'Portable native Original row missing.'); records.push(record as Record<string, unknown>);
				const token: unknown = Object.getOwnPropertyDescriptor(record, 'mediaChunkToken')?.value;
				check(typeof token === 'string' && token.length > 0, 'Portable native Original chunk token missing.');
				const chunk: unknown = await request(chunkStore.get(`${token}:0000000000`));
				check(chunk !== null && typeof chunk === 'object' && !Array.isArray(chunk), 'Portable native Original chunk missing.'); chunks.push(chunk as Record<string, unknown>);
			}
			return { rows, records, chunks };
		});
	} finally { database.close(); }
}

function nativeOriginalChunkBlob(record: Record<string, unknown>, chunks: readonly Record<string, unknown>[]): Blob {
	check(record.mediaChunkBytes === MEDIA_ASSET_STREAM_CHUNK_BYTES && record.mediaChunkCount === 1
		&& typeof record.size === 'number' && record.size > 0 && record.size <= 4096, 'Portable native chunk geometry exceeds its exact fixture.');
	const retained = chunks.filter(chunk => chunk.mediaChunkToken === record.mediaChunkToken), chunk = retained[0];
	check(retained.length === 1 && chunk !== undefined && chunk.sourceId === record.sourceId
		&& chunk.key === `${String(record.mediaChunkToken)}:0000000000` && chunk.index === 0
		&& chunk.byteLength === record.size && chunk.payloadEncoding === 'array-buffer-v1'
		&& chunk.payloadBytes instanceof ArrayBuffer && chunk.payloadBytes.byteLength === record.size,
		'Portable native chunk ownership, encoding or byte lengths differ.');
	const bytes = new Uint8Array(chunk.payloadBytes);
	try { return canonicalMediaContentBlob(new Blob([bytes], { type: String(record.mimeType ?? '') })); }
	finally { bytes.fill(0); }
}

function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }

/** Scalar namespace observation acquires no Original or resource body. */
export async function readRepairPortableLocationNativeV1() {
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, preferOpfs: false, syncWorkerClient: null });
	let result: Awaited<ReturnType<typeof read>> | undefined, failed = false, failure: unknown;
	async function read() {
		await anchor.ready();
		const selected = await withPhotoLibraryInitializationLockV1(navigator.locks,
			() => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
				initializeDefault: async () => { throw Error('Portable observer cannot initialize a library.'); } }));
		return { pointer: selected.pointer, location: selected.location };
	}
	try { result = await read(); } catch (error) { failed = true; failure = error; }
	const outcomes = await Promise.allSettled([anchor.close()]);
	const errors = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
	if (failed && !errors.length) throw failure;
	if (errors.length) throw new AggregateError(failed ? [failure, ...errors] : errors, 'Portable location or cleanup failed.', failed ? { cause: failure } : undefined);
	if (result === undefined) throw Error('Portable location did not complete.');
	return result;
}

/** Hold only observation of a genuine completed pointer/commit transaction.
 * Native DOM prototypes cover the separately bundled product and observer. */
export function holdRepairPortablePublicationNativeV1() {
	const completion = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
	if (!completion?.set) throw Error('Actual native transaction completion setter is missing.');
	const setter = completion.set, put = IDBObjectStore.prototype.put;
	const targets = new WeakSet<IDBTransaction>(), waiting: (() => void)[] = [];
	let attempts = 0, acknowledged: boolean | null = null, held = false;
	let armed = true;
	Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { ...completion, set(this: IDBTransaction, callback: unknown) {
		const invoke = typeof callback !== 'function' ? callback : function (this: IDBTransaction, event: Event) {
			if (armed && targets.has(this)) {
				acknowledged = true; held = true; waiting.push(() => { void Reflect.apply(callback, this, [event]); });
			} else void Reflect.apply(callback, this, [event]);
		};
		void Reflect.apply(setter, this, [invoke]);
	} });
	IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
		const storedKey: unknown = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'key')?.value : undefined;
		const stored: unknown = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'value')?.value : undefined;
		const version: unknown = stored && typeof stored === 'object' ? Object.getOwnPropertyDescriptor(stored, 'schemaVersion')?.value : undefined;
		if (armed && this.name === 'settings' && this.transaction.db.name === PHOTO_LIBRARY_DEFAULT_SETTINGS_DATABASE_NAME_V2
			&& storedKey === PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 && version === 2) { attempts++; targets.add(this.transaction); }
		return Reflect.apply(put, this, key === undefined ? [value] : [value, key]) as IDBRequest<IDBValidKey>;
	};
	function release() {
		armed = false; held = false;
		Object.defineProperty(IDBTransaction.prototype, 'oncomplete', completion!); IDBObjectStore.prototype.put = put;
		for (const deliver of waiting.splice(0)) deliver();
	}
	return Object.freeze({ status: () => ({ attempts, acknowledged, held }), release, restore: release });
}
