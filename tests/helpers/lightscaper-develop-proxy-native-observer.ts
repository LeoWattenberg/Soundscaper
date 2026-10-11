/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { digestMediaContent } from '../../src/common/editor/storage/media-content-digest.ts';
import { normalizeCatalogOriginalRoot, type CatalogOriginalRootV1 } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import type { PhotoDocumentV1 } from '../../src/lightscaper/catalog/types.ts';
import type { PhotoDocumentV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { withPhotoLibraryInitializationLockV1 } from '../../src/lightscaper/storage/photo-library-namespace-lock-v1.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';

export interface PhotoDevelopProxyOriginalCustodyV1 {
	readonly metadata: Record<string, unknown>;
	readonly mediaContentToken: string;
	readonly recordJson: string;
	readonly roots: readonly Readonly<CatalogOriginalRootV1>[];
	readonly publicRoots: readonly Readonly<CatalogOriginalRootV1>[];
	readonly sha256: string;
	readonly byteLength: number;
}
export interface PhotoDevelopProxyCustodyV1 {
	readonly photo: Readonly<PhotoDocumentV1 | PhotoDocumentV2>;
	readonly namespace: string | null;
	readonly original: Readonly<PhotoDevelopProxyOriginalCustodyV1>;
}

/** Independent native/public custody readings must authenticate the exact one-original workload.
 * The probe is complete only for this fresh fixture, never a general catalog inventory. */
export function validatePhotoDevelopProxyCustodyV1(photo: Pick<PhotoDocumentV1, 'id' | 'catalogId' | 'original'>,
	metadata: Record<string, unknown>, raw: unknown, rows: readonly unknown[],
	publicPage: { readonly roots: readonly unknown[]; readonly afterKey: string | null }, sha256: string, byteLength: number): PhotoDevelopProxyOriginalCustodyV1 {
	check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'Original scalar record missing.');
	const record = raw as Record<string, unknown>, original = photo.original;
	check(Object.values(record).every(value => value === undefined || value === null
		|| typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)),
		'The actual OPFS scalar record must not hide a binary body.');
	const mediaContentToken = record.mediaContentToken;
	check(typeof mediaContentToken === 'string', 'Original content token missing.');
	check(metadata.sourceId === original.storageKey && metadata.sha256 === original.contentSha256 && metadata.size === original.byteLength,
		'Original metadata differs from the retained Photo.');
	check(record.sourceId === original.storageKey && record.sha256 === original.contentSha256 && record.size === original.byteLength,
		'Original native record differs from the retained Photo.');
	check(sha256 === original.contentSha256 && byteLength === original.byteLength, 'Original encoded body differs from its retained identity.');
	check(rows.length === 1 && publicPage.roots.length === 1 && publicPage.afterKey === null, 'Fixture custody must contain exactly one complete permanent original.');
	const roots = rows.map(normalizeCatalogOriginalRoot), publicRoots = publicPage.roots.map(normalizeCatalogOriginalRoot);
	const root = roots[0]!;
	check(root.catalogId === photo.catalogId && root.photoId === photo.id && root.importId === null
		&& root.assetId === original.storageKey && root.sourceId === original.id && root.sha256 === sha256
		&& root.size === byteLength && root.mediaContentToken === mediaContentToken, 'Native original custody binding changed.');
	check(JSON.stringify(roots) === JSON.stringify(publicRoots), 'Native and public original custody disagree.');
	return { metadata, mediaContentToken, recordJson: JSON.stringify(record), roots, publicRoots, sha256, byteLength };
}

/** Run after the presentation timing endpoint. Read actual selected storage and stream its
 * encoded original in 64 KiB pieces; return bounded scalar facts after all owners join. */
export async function readPhotoDevelopProxyCustodyNativeV1(photoId: string,
	beforeClose?: () => Promise<void>): Promise<PhotoDevelopProxyCustodyV1> {
	const anchor = new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryV2 | null = null;
	let result: PhotoDevelopProxyCustodyV1 | undefined, failed = false, failure: unknown;
	try {
		await anchor.ready();
		const readSelection = () => withPhotoLibraryInitializationLockV1(navigator.locks, () => readPhotoLibrarySessionLocationV2({
			settings: anchor.settingsRepository, initializeDefault: async () => { throw new Error('A read-only observer cannot initialize a library.'); },
		}));
		const selected = await readSelection();
		media = selected.allocation ? new PhotoMediaStoreV1({ indexedDB, locks: navigator.locks,
			databaseName: selected.location.mediaDatabaseName, preferOpfs: false }) : anchor;
		await media.ready();
		const resources = await media.getCubeLutResources();
		catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: selected.location.catalogDatabaseName,
			verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
		const photo = await catalog.loadPhoto(selected.location.catalogId, photoId);
		check(photo !== null, 'Imported current Photo missing.');
		await media.verifyOriginal(photo.original); await resources.verifyPhoto(photo);
		const metadata = await media.mediaRepository.getAssetMetadata(photo.original.storageKey);
		check(metadata !== null && metadata.storage === 'opfs' && typeof metadata.path === 'string', 'Actual fresh original must prove native OPFS storage.');
		const body = await media.mediaRepository.loadAsset(photo.original.storageKey);
		check(body !== null, 'Retained encoded original body missing.');
		const sha256 = await digestMediaContent(body, { chunkBytes: 64 * 1024 });
		const publicPage = await media.mediaRepository.catalogOriginals.readPage({ catalogId: photo.catalogId });
		const native = await readNativeCustody(selected.location.mediaDatabaseName, photo.original.storageKey);
		const original = validatePhotoDevelopProxyCustodyV1(photo, metadata, native.record, native.rows, publicPage, sha256, body.size);
		check(JSON.stringify((await readSelection()).pointer) === JSON.stringify(selected.pointer), 'Selected namespace changed during observation.');
		await beforeClose?.();
		result = { photo, namespace: selected.location.namespaceToken, original };
	} catch (error) { failed = true; failure = error; }
	const owners = new Set([catalog, media, anchor]);
	const closed = await Promise.allSettled([...owners].filter(owner => owner !== null).map(owner => owner.close()));
	const errors = closed.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason as unknown] : []);
	if (failed && !errors.length) throw failure;
	if (errors.length) throw new AggregateError(failed ? [failure, ...errors] : errors, 'Proxy custody observation or joined owner cleanup failed.', failed ? { cause: failure } : undefined);
	check(result !== undefined, 'Proxy custody observation did not complete.');
	return result;
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
			const assetStore = stores.mediaAssets, rootStore = stores.catalogOriginalRoots;
			check(assetStore !== undefined && rootStore !== undefined, 'Native original stores missing.');
			const record: unknown = await request(assetStore.get(assetId));
			// Three is a refusal probe: exactly one root succeeds; extra permanent or
			// staged rows fail rather than pretending one 64-row public page is exhaustive.
			const rows: unknown[] = await request(rootStore.getAll(undefined, 3));
			return { record, rows };
		});
	} finally { database.close(); }
}

function check(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
