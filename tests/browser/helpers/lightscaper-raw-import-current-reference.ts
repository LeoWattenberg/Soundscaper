/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { compilePinnedLibRawModuleV1 } from '../../../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { decodeLibRawOriginalWasmV1 } from '../../../src/common/editor/raw/libraw-wasm-instance-v1.ts';
import { validatePhotoDevelopProxyCustodyV1 } from '../../helpers/lightscaper-develop-proxy-native-observer.ts';

let compiled: Promise<WebAssembly.Module> | undefined;
async function nativeModule() {
	compiled ??= (async () => {
		const response = await fetch('https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm', { credentials: 'omit', redirect: 'error', mode: 'cors' });
		check(response.ok, 'Pinned native RAW witness module is unavailable.');
		const bytes = new Uint8Array(await response.arrayBuffer());
		try { return await compilePinnedLibRawModuleV1(bytes); } finally { bytes.fill(0); }
	})();
	return compiled;
}

/** One fresh Photo, one real OPFS Original and one independently opened native
 * decoder instance. This observer cannot import, publish, replace the app's
 * Session/Worker, or manufacture an eight-bit source. Its own read-only media
 * owner uses the browser's native asynchronous OPFS reader, with no worker URL
 * rewriting. All returned word arrays are bounded scalar observations. */
export async function readRawImportCustodyCurrentV1(photoId: string) {
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined;
	let bytes: Uint8Array<ArrayBuffer> | undefined, pixels: Uint16Array<ArrayBuffer> | undefined;
	async function observe() {
		await anchor.ready();
		const selection = await withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({
			settings: anchor.settingsRepository, initializeDefault: async () => { throw new Error('RAW observer cannot initialize a library.'); },
		}));
		media = selection.location.mediaDatabaseName === 'lightscaper-photo-media-v2' ? anchor : new PhotoMediaStoreV1({
			indexedDB, locks: navigator.locks, databaseName: selection.location.mediaDatabaseName, syncWorkerClient: null });
		await media.ready(); const owner = media;
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selection.location.catalogDatabaseName, verifyOriginal: owner.verifyOriginal });
		const photo = await catalog.loadPhoto(selection.location.catalogId, photoId); check(photo !== null, 'Imported Current RAW Photo missing.');
		const metadata = await owner.mediaRepository.getAssetMetadata(photo.original.storageKey);
		check(metadata !== null && metadata.storage === 'opfs', 'RAW Original must reside in actual OPFS.');
		const body = await owner.mediaRepository.loadAsset(photo.original.storageKey);
		check(body instanceof Blob && body.size <= 4096, 'RAW witness requires the complete bounded owned DNG.');
		const sha256 = await digestMediaContent(body, { chunkBytes: 4096 }), native = await custody(selection.location.mediaDatabaseName, photo.original.storageKey);
		const publicRoots = await owner.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
		const original = validatePhotoDevelopProxyCustodyV1(photo, metadata, native.record, native.roots, publicRoots, sha256, body.size);
		bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(body));
		const decoded = decodeLibRawOriginalWasmV1(await nativeModule(), bytes); pixels = decoded.frame.pixels;
		check(pixels.length === 4096 && decoded.frame.descriptor.width === 32 && decoded.frame.descriptor.height === 32,
			'RAW witness native dimensions exceed the owned fixture.');
		const words = Array.from(pixels), after = await custody(selection.location.mediaDatabaseName, photo.original.storageKey);
		check(JSON.stringify(after) === JSON.stringify(native), 'Native Original record or permanent custody changed during observation.');
		check(JSON.stringify(await catalog.loadPhoto(selection.location.catalogId, photoId)) === JSON.stringify(photo), 'Photo changed during RAW observation.');
		check(await digestMediaContent(body, { chunkBytes: 4096 }) === sha256, 'RAW Original bytes changed during native decode.');
		return { photo, original, namespace: selection.location.namespaceToken, bytes: Array.from(bytes),
			native: { descriptor: decoded.frame.descriptor, rawFlip: decoded.rawFlip, words } };
	}
	const outcome = await observe().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const errors: unknown[] = [];
	try { bytes?.fill(0); } catch (error) { errors.push(error); }
	try { pixels?.fill(0); } catch (error) { errors.push(error); }
	const owners = new Set([catalog, media, anchor]);
	const results = await Promise.allSettled([...owners].filter(owner => owner !== undefined).map(owner => Promise.resolve().then(() => owner.close())));
	for (const result of results) if (result.status === 'rejected') errors.push(result.reason as unknown);
	if (!outcome.ok) {
		if (errors.length) throw new AggregateError([outcome.error, ...errors], 'RAW custody observer failed and cleanup did not complete.', { cause: outcome.error });
		throw outcome.error;
	}
	if (errors.length) throw new AggregateError(errors, 'RAW custody observer cleanup did not complete.');
	return outcome.value;
}

async function custody(databaseName: string, storageKey: string) {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
		opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true });
	});
	try {
		return await transact(database, ['mediaAssets', 'catalogOriginalRoots'], 'readonly', async stores => {
			check(stores.mediaAssets && stores.catalogOriginalRoots, 'Actual RAW native custody stores are missing.');
			const roots: unknown[] = await request(stores.catalogOriginalRoots.getAll(undefined, 2));
			check(roots.length === 1, 'RAW fixture requires exactly one complete Original custody root.');
			const record: unknown = await request(stores.mediaAssets.get(storageKey)); return { record, roots };
		});
	} finally { database.close(); }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
