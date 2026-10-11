/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { validatePhotoDevelopProxyCustodyV1 } from '../../helpers/lightscaper-develop-proxy-native-observer.ts';

export const REPAIR_REFERENCE_WIDTH = 10, REPAIR_REFERENCE_HEIGHT = 5;
export function repairOriginalReferencePixelsV1(): number[] {
	const pixels = Array.from({ length: 50 }, () => [0, 0, 0, 255]).flat();
	for (let y = 1; y <= 3; y++) for (let x = 0; x <= 3; x++) pixels.fill(64, (y * 10 + x) * 4, (y * 10 + x) * 4 + 3);
	for (const [x, y] of [[8, 2], [7, 1], [7, 3]] as const) pixels.fill(255, (y * 10 + x) * 4, (y * 10 + x) * 4 + 3);
	return pixels;
}
/** Independent two-cell solution: 5uL-uR=.5, 5uR-uL=3.5 -> linear (.25,.75). */
export function repairOutputReferencePixelsV1(mode: 'clone' | 'heal'): number[] {
	const pixels = repairOriginalReferencePixelsV1(), values = mode === 'clone' ? [64, 64] : [137, 225];
	for (const [index, value] of values.entries()) pixels.fill(value, (26 + index) * 4, (26 + index) * 4 + 3);
	return pixels;
}
/** Literal max-four-neighbor linear-luminance edge result at threshold .02. */
export function repairEdgeReferencePixelsV1(): number[] {
	return [
		32, 32, 32, 32, 0, 0, 0, 255, 0, 0,
		32, 32, 32, 32, 32, 0, 255, 255, 255, 0,
		0, 0, 0, 32, 32, 0, 0, 255, 255, 255,
		32, 32, 32, 32, 32, 0, 255, 255, 255, 0,
		32, 32, 32, 32, 0, 0, 0, 255, 0, 0,
	].flatMap(value => [value, value, value, 255]);
}

/** Observe actual Current rows and native OPFS Original custody, then close all owners.
 * This one-photo fixture refuses extra roots; it is not a general library inventory. */
export async function readRepairPhotoCustodyNativeV1(photoId: string, beforeClose?: () => Promise<void>) {
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryCurrentV1 | null = null;
	let failed = false, failure: unknown, result: Awaited<ReturnType<typeof read>> | undefined;
	async function read() {
		await anchor.ready();
		const selected = await readSelection();
		media = selected.allocation ? new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false }) : anchor;
		await media.ready(); const selectedMedia = media;
		const verifyResources = (photo: unknown, signal?: AbortSignal) => verifyPhotoResourcesCurrentV1(photo, {
			cubeLutResources: () => selectedMedia.getCubeLutResources(), maskRasterResources: () => selectedMedia.getMaskRasterResources(),
		}, signal);
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selected.location.catalogDatabaseName,
			verifyOriginal: selectedMedia.verifyOriginal, verifyResources });
		const photo = await catalog.loadPhoto(selected.location.catalogId, photoId); check(photo !== null, 'Actual Current Photo missing.');
		await media.verifyOriginal(photo.original); await verifyResources(photo);
		const metadata = await media.mediaRepository.getAssetMetadata(photo.original.storageKey);
		check(metadata !== null && metadata.storage === 'opfs' && typeof metadata.path === 'string', 'The Original must prove actual native OPFS storage.');
		const body = await media.mediaRepository.loadAsset(photo.original.storageKey); check(body !== null, 'Encoded Original missing.');
		const sha256 = await digestMediaContent(body, { chunkBytes: 64 * 1024 });
		const publicPage = await media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
		const native = await readNativeCustody(selected.location.mediaDatabaseName, photo.original.storageKey);
		const original = validatePhotoDevelopProxyCustodyV1(photo, metadata, native.record, native.rows, publicPage, sha256, body.size);
		check(JSON.stringify((await readSelection()).pointer) === JSON.stringify(selected.pointer), 'Selected namespace changed during observation.');
		await beforeClose?.(); return { photo, namespace: selected.location.namespaceToken, original };
	}
	function readSelection() {
		return withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw Error('The read-only observer cannot initialize a library.'); } }));
	}
	try { result = await read(); } catch (error) { failed = true; failure = error; }
	const owners = new Set([catalog, media, anchor]);
	const closed = await Promise.allSettled([...owners].filter(owner => owner !== null).map(owner => owner.close()));
	const errors = closed.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
	if (failed && !errors.length) throw failure;
	if (errors.length) throw new AggregateError(failed ? [failure, ...errors] : errors, 'Current custody observation or joined cleanup failed.', failed ? { cause: failure } : undefined);
	check(result !== undefined, 'Current custody observation did not complete.'); return result;
}

async function readNativeCustody(databaseName: string, assetId: string) {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
		opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true });
	});
	try {
		return await transact(database, ['mediaAssets', 'catalogOriginalRoots'], 'readonly', async stores => {
			const assets = stores.mediaAssets, roots = stores.catalogOriginalRoots; check(assets !== undefined && roots !== undefined, 'Native Original stores missing.');
			const record: unknown = await request(assets.get(assetId)), rows: unknown[] = await request(roots.getAll(undefined, 3));
			return { record, rows };
		});
	} finally { database.close(); }
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
