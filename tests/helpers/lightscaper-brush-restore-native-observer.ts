/* SPDX-License-Identifier: AGPL-3.0-only */

// Read-only native observer for the actual selected archive restore namespace.
import { digestMediaContent } from '../../src/common/editor/storage/media-content-digest.ts';
import { aggregateScapeErrors } from '../../src/common/editor/scape-abort.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { createPhotoMaskRasterReachabilityV1 } from '../../src/lightscaper/catalog/photo-mask-raster-reachability-v1.ts';

export async function observeBrushRestoreNative(photoId: string, checkpoint?: () => Promise<void>) {
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryV2 | null = null;
	let failed = false, failure: unknown;
	let needsCheckpoint = false;
	let result: Awaited<ReturnType<typeof observe>> | undefined;
	try {
		result = await observe();
	} catch (error) { failed = true; failure = error; }
	const checkpointFailures: unknown[] = [];
	if (needsCheckpoint) { try { await checkpoint?.(); } catch (error) { checkpointFailures.push(error); } }
	const owners = [catalog, media, anchor].filter(owner => owner !== null);
	const outcomes = await Promise.allSettled(owners.map(owner => owner.close()));
	const failures = [...checkpointFailures, ...outcomes.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])];
	if (failed) throw aggregateScapeErrors(failure, failures, 'Native brush observation and cleanup failed.', { primaryIsAbort: false });
	if (failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failures, 'Native brush observer cleanup failed.');
	if (result === undefined) throw Error('Native brush observer did not complete.');
	return result;

	async function observe() {
		await anchor.ready();
		const selected = await withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({
			settings: anchor.settingsRepository, initializeDefault: () => Promise.reject(Error('Read-only observer requires existing selection.')) }));
		needsCheckpoint = selected.allocation === null;
		media = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks, databaseName: selected.location.mediaDatabaseName,
			preferOpfs: selected.allocation === null });
		await media.ready(); const masks = await media.getMaskRasterResources(), luts = await media.getCubeLutResources();
		catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: selected.location.catalogDatabaseName,
			verifyOriginal: media.verifyOriginal, verifyResources: async (photo, signal) => {
				await luts.verifyPhoto(photo, signal); await masks.verifyPhoto(photo, signal);
			} });
		const photo = await catalog.loadPhoto(selected.location.catalogId, photoId); if (!photo) throw Error('Retained brush Photo missing.');
		await media.verifyOriginal(photo.original); await masks.verifyPhoto(photo); await luts.verifyPhoto(photo);
		const original = await media.mediaRepository.loadAsset(photo.original.storageKey); if (!original) throw Error('Encoded original missing.');
		const originalSha256 = await digestMediaContent(original), custody = await media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
		const retained = custody.roots[0];
		if (originalSha256 !== photo.original.contentSha256 || original.size !== photo.original.byteLength
			|| custody.roots.length !== 1 || custody.afterKey !== null || retained?.importId !== null
			|| retained.catalogId !== photo.catalogId || retained.photoId !== photo.id || retained.sourceId !== photo.original.id
			|| retained.assetId !== photo.original.storageKey || retained.sha256 !== originalSha256 || retained.size !== original.size) {
			throw Error('Restored permanent original custody differs.');
		}
		const closure = createPhotoMaskRasterReachabilityV1(); closure.addPhoto(photo);
		const bodies: { key: string; bytes: number[] }[] = [];
		for (const reference of closure.finish()) await masks.source.withBytes(reference, bytes => { bodies.push({ key: reference.storageKey, bytes: [...bytes] }); });
		const metadata = await media.mediaRepository.getAssetMetadata(photo.original.storageKey);
		return { photo, names: { catalogDatabaseName: selected.location.catalogDatabaseName, mediaDatabaseName: selected.location.mediaDatabaseName },
			pointer: selected.pointer, originalSha256, originalSize: original.size, custody, metadata, bodies };
	}
}
