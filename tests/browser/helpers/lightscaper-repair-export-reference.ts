/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../../src/common/editor/storage/indexeddb-backend.ts';
import { digestMediaContent } from '../../../src/common/editor/storage/media-content-digest.ts';
import { normalizeCatalogOriginalRoot } from '../../../src/common/editor/storage/media-catalog-original-schema.ts';
import { PhotoCatalogRepositoryCurrentV1 } from '../../../src/lightscaper/catalog/photo-catalog-repository-current-v1.ts';
import { PhotoMediaStoreV1 } from '../../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { verifyPhotoResourcesCurrentV1 } from '../../../src/lightscaper/storage/photo-media-resource-verification-current-v1.ts';
import { validatePhotoDevelopProxyCustodyV1 } from '../../helpers/lightscaper-develop-proxy-native-observer.ts';

/** Complete custody of the fresh one/two-photo export fixture, including retained repair history.
 * This bounded observer refuses extra roots and cannot initialize or publish a library. */
export async function readRepairExportCustodyNativeV1(photoIds: readonly string[], beforeClose?: () => Promise<void>) {
	check(photoIds.length >= 1 && photoIds.length <= 2 && new Set(photoIds).size === photoIds.length, 'Export fixture needs one or two distinct Photos.');
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryCurrentV1 | null = null;
	let result: Awaited<ReturnType<typeof read>> | undefined, failed = false, failure: unknown;
	async function read() {
		await anchor.ready(); const selected = await readSelection();
		media = selected.allocation ? new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false }) : anchor;
		await media.ready(); const selectedMedia = media;
		const verify = (photo: unknown, signal?: AbortSignal) => verifyPhotoResourcesCurrentV1(photo, {
			cubeLutResources: () => selectedMedia.getCubeLutResources(), maskRasterResources: () => selectedMedia.getMaskRasterResources(),
		}, signal);
		catalog = new PhotoCatalogRepositoryCurrentV1({ indexedDB, databaseName: selected.location.catalogDatabaseName,
			verifyOriginal: selectedMedia.verifyOriginal, verifyResources: verify });
		const publicPage = await media.mediaRepository.catalogOriginals.readPage({ catalogId: selected.location.catalogId });
		const native = await readNativeCustody(selected.location.mediaDatabaseName, photoIds.length);
		const nativeRoots = native.rows.map(normalizeCatalogOriginalRoot), publicRoots = publicPage.roots.map(normalizeCatalogOriginalRoot);
		check(nativeRoots.length === photoIds.length && publicRoots.length === photoIds.length && publicPage.afterKey === null, 'Export fixture has extra or incomplete Original custody.');
		check(nativeRoots.every(root => photoIds.includes(root.photoId) && root.importId === null)
			&& JSON.stringify(nativeRoots) === JSON.stringify(publicRoots), 'Native/public complete Original custody differs.');
		const photos = [];
		for (const photoId of photoIds) {
			const photo = await catalog.loadPhoto(selected.location.catalogId, photoId); check(photo !== null, 'Actual Current export Photo missing.');
			await media.verifyOriginal(photo.original); await verify(photo);
			const metadata = await media.mediaRepository.getAssetMetadata(photo.original.storageKey);
			check(metadata !== null && metadata.storage === 'opfs' && typeof metadata.path === 'string', 'Export Original needs actual native OPFS storage.');
			const body = await media.mediaRepository.loadAsset(photo.original.storageKey); check(body !== null, 'Export Original body missing.');
			const sha256 = await digestMediaContent(body, { chunkBytes: 64 * 1024 });
			const record = native.records.find(row => row.sourceId === photo.original.storageKey); check(record !== undefined, 'Native Original scalar record missing.');
			const original = validatePhotoDevelopProxyCustodyV1(photo, metadata, record, nativeRoots.filter(root => root.photoId === photoId),
				{ roots: publicRoots.filter(root => root.photoId === photoId), afterKey: null }, sha256, body.size);
			photos.push({ photo, original });
		}
		check(JSON.stringify((await readSelection()).pointer) === JSON.stringify(selected.pointer), 'Export observer selected namespace changed.');
		await beforeClose?.(); return { photos, namespace: selected.location.namespaceToken };
	}
	function readSelection() {
		return withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
			initializeDefault: async () => { throw Error('Export observer cannot initialize a library.'); } }));
	}
	try { result = await read(); } catch (error) { failed = true; failure = error; }
	const owners = new Set([catalog, media, anchor]);
	const closed = await Promise.allSettled([...owners].filter(owner => owner !== null).map(owner => owner.close()));
	const errors = closed.flatMap(value => value.status === 'rejected' ? [value.reason as unknown] : []);
	if (failed && !errors.length) throw failure;
	if (errors.length) throw new AggregateError(failed ? [failure, ...errors] : errors, 'Export custody observation or joined cleanup failed.', failed ? { cause: failure } : undefined);
	check(result !== undefined, 'Export custody observation did not complete.'); return result;
}

async function readNativeCustody(databaseName: string, count: number) {
	const database = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.addEventListener('upgradeneeded', () => opening.transaction?.abort(), { once: true });
		opening.addEventListener('error', () => reject(opening.error), { once: true });
		opening.addEventListener('success', () => resolve(opening.result), { once: true });
	});
	try {
		return await transact(database, ['mediaAssets', 'catalogOriginalRoots'], 'readonly', async stores => {
			const assets = stores.mediaAssets, roots = stores.catalogOriginalRoots; check(assets !== undefined && roots !== undefined, 'Native export Original stores missing.');
			const rows: unknown[] = await request(roots.getAll(undefined, count + 1));
			const records: Record<string, unknown>[] = await Promise.all(rows.map(async value => {
				const root = normalizeCatalogOriginalRoot(value), record: unknown = await request(assets.get(root.assetId));
				check(record !== null && typeof record === 'object' && !Array.isArray(record), 'Native export Original scalar row missing.');
				return record as Record<string, unknown>;
			})); return { records, rows };
		});
	} finally { database.close(); }
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
