/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { createPhotoResourceReachabilityCurrentV1 } from '../../../src/lightscaper/catalog/photo-resource-reachability-current-v1.ts';
import { compilePinnedLibRawModuleV1 } from '../../../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { compilePinnedLibRawRecoveryModuleV2 } from '../../../src/common/editor/raw/libraw-runtime-asset-v2.ts';
import { decodeLibRawOriginalWasmV1 } from '../../../src/common/editor/raw/libraw-wasm-instance-v1.ts';
import { decodeLibRawRecoveryWasmV2, type RawRecoveryProfileV2 } from '../../../src/common/editor/raw/libraw-wasm-instance-v2.ts';
import { validatePhotoDevelopProxyCustodyV1 } from '../../helpers/lightscaper-develop-proxy-native-observer.ts';

let canonicalModule: Promise<WebAssembly.Module> | undefined, recoveryModule: Promise<WebAssembly.Module> | undefined;
function nativeModule(recovery: boolean) {
	const load = async () => {
		const url = recovery ? 'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm'
			: 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm';
		const response = await fetch(url, { credentials: 'omit', mode: 'cors', redirect: 'error' });
		check(response.ok, 'The pinned RAW development witness runtime is unavailable.');
		const bytes = new Uint8Array(await response.arrayBuffer());
		try { return await (recovery ? compilePinnedLibRawRecoveryModuleV2(bytes) : compilePinnedLibRawModuleV1(bytes)); }
		finally { bytes.fill(0); }
	};
	return recovery ? recoveryModule ??= load() : canonicalModule ??= load();
}

/** One actual Current Photo, its complete Original root and native OPFS body.
 * This observer only reads committed state and independently invokes the C ABI.
 * It never creates/replaces an app Session, Worker, import, recipe or renderer.
 * Each native plane retires before the next profile is decoded. */
export async function readRawDevelopmentCustodyCurrentV1(photoId: string) {
	check(typeof photoId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(photoId), 'The RAW observer requires an exact Photo ID.');
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, syncWorkerClient: null });
	let media: PhotoMediaStoreV1 | undefined, catalog: PhotoCatalogRepositoryCurrentV1 | undefined, bytes: Uint8Array<ArrayBuffer> | undefined;
	const observe = async () => {
		await anchor.ready();
		const selected = await withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({
			settings: anchor.settingsRepository, initializeDefault: async () => { throw new Error('The RAW observer cannot initialize a library.'); },
		}));
		media = selected.location.mediaDatabaseName === 'lightscaper-photo-media-v2' ? anchor : new PhotoMediaStoreV1({
			indexedDB, locks: navigator.locks, databaseName: selected.location.mediaDatabaseName, syncWorkerClient: null });
		await media.ready(); const owner = media;
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selected.location.catalogDatabaseName, verifyOriginal: owner.verifyOriginal });
		const photo = await catalog.loadPhoto(selected.location.catalogId, photoId); check(photo !== null, 'The actual Current RAW Photo is missing.');
		const closure = createPhotoResourceReachabilityCurrentV1(); closure.addPhoto(photo);
		const references = closure.finish(); check(references.luts.length === 0 && references.brushes.length === 0, 'The RAW workflow has an unobserved retained resource body.');
		check(photo.original.width === 96 && photo.original.height === 128 && photo.original.byteLength <= 32_768,
			'The RAW observer requires the owned oriented128×96 recovery DNG.');
		const metadata = await owner.mediaRepository.getAssetMetadata(photo.original.storageKey);
		check(metadata !== null && metadata.storage === 'opfs', 'The actual RAW Original must reside in OPFS.');
		const body = await owner.mediaRepository.loadAsset(photo.original.storageKey);
		check(body instanceof Blob && body.size === photo.original.byteLength, 'The actual RAW Original body is missing or changed.');
		const sha256 = await digestMediaContent(body, { chunkBytes: 4096 }), before = await custody(selected.location.mediaDatabaseName, photo.original.storageKey);
		const publicRoots = await owner.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
		const original = validatePhotoDevelopProxyCustodyV1(photo, metadata, before.record, before.roots, publicRoots, sha256, body.size);
		bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(body));
		const canonical = decodeLibRawOriginalWasmV1(await nativeModule(false), bytes);
		let baseline: { descriptor: typeof canonical.frame.descriptor; rawFlip: number; words: number[] };
		try {
			check(canonical.frame.descriptor.width === 96 && canonical.frame.descriptor.height === 128 && canonical.rawFlip === 6,
				'The actual canonical RAW orientation/extent differs from the fixture.');
			baseline = { descriptor: canonical.frame.descriptor, rawFlip: canonical.rawFlip, words: Array.from(canonical.frame.pixels) };
		} finally { canonical.frame.pixels.fill(0); }
		const compiled = await nativeModule(true);
		const derived = (profile: RawRecoveryProfileV2) => {
			const decoded = decodeLibRawRecoveryWasmV2(compiled, bytes!, profile);
			try {
				check(decoded.frame.descriptor.width === 96 && decoded.frame.descriptor.height === 128 && decoded.rawFlip === 6
					&& decoded.profile === profile && decoded.exposureScale > 1, 'The actual derived RAW orientation/profile/normalization differs.');
				return { descriptor: decoded.frame.descriptor, rawFlip: decoded.rawFlip, profile: decoded.profile,
					exposureScale: decoded.exposureScale, samples: Array.from(decoded.frame.pixels) };
			} finally { decoded.frame.pixels.fill(0); }
		};
		const headroom = derived('linear-headroom-v1'), recovery = derived('highlight-recovery-v1');
		check(headroom.exposureScale === recovery.exposureScale, 'H1 and H3 must share the same applied normalization.');
		check(JSON.stringify(await custody(selected.location.mediaDatabaseName, photo.original.storageKey)) === JSON.stringify(before),
			'The native Original content token or permanent custody changed during observation.');
		check(JSON.stringify(await catalog.loadPhoto(selected.location.catalogId, photoId)) === JSON.stringify(photo), 'The Photo changed during RAW observation.');
		check(await digestMediaContent(body, { chunkBytes: 4096 }) === sha256, 'The RAW Original changed during native decoding.');
		return { photo, original, namespace: selected.location.namespaceToken, bytes: Array.from(bytes), native: { canonical: baseline, headroom, recovery } };
	};
	const result = await observe().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	const failures: unknown[] = [];
	try { bytes?.fill(0); } catch (error) { failures.push(error); }
	const owners = [...new Set([catalog, media, anchor])].filter(owner => owner !== undefined);
	for (const outcome of await Promise.allSettled(owners.map(owner => Promise.resolve().then(() => owner.close())))) {
		if (outcome.status === 'rejected') failures.push(outcome.reason as unknown);
	}
	if (!result.ok) {
		if (failures.length) throw new AggregateError([result.error, ...failures], 'RAW development observation and retirement failed.', { cause: result.error });
		throw result.error;
	}
	if (failures.length) throw new AggregateError(failures, 'RAW development observer retirement failed.');
	return result.value;
}

async function custody(databaseName: string, storageKey: string) {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
		opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true });
	});
	try { return await transact(database, ['mediaAssets', 'catalogOriginalRoots'], 'readonly', async stores => {
		check(stores.mediaAssets && stores.catalogOriginalRoots, 'The native RAW custody stores are missing.');
		const roots: unknown[] = await request(stores.catalogOriginalRoots.getAll(undefined, 2));
		check(roots.length === 1, 'The RAW workflow requires exactly one complete Original custody root.');
		const record: unknown = await request(stores.mediaAssets.get(storageKey)); return { record, roots };
	}); } finally { database.close(); }
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
