/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { IMAGE_IMPORT_LIMITS } from '../../common/editor/image-import-admission.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../../common/editor/storage/media-content-digest.ts';
import type { CatalogOriginalReferenceV1 } from '../../common/editor/storage/media-catalog-original-schema.ts';
import type { PhotoCatalogPackInput } from '../archive/catalog-pack.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { normalizePhotoDocumentV1, validatePhotoCatalogReferencesV1 } from '../catalog/photo-document.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { id } from '../catalog/value-validation.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1, settlePhotoImportRootsV1, type PhotoImportIntentV1 } from './import-intent-v1.ts';
import { withPhotoCatalogWriteLockV1 } from './catalog-write-lock-v1.ts';
import type { PhotoManagedImportPortsV1, PhotoManagedImportReceiptV1 } from './managed-import-ports-v1.ts';

export { photoImportIntentKeyV1 } from './import-intent-v1.ts';
export type { PhotoManagedImportPortsV1, PhotoManagedImportReceiptV1 } from './managed-import-ports-v1.ts';

/** Preparation admits the complete gesture before this serial publication owner. */
export async function importManagedPhotosV1(
	catalogId: string,
	photos: Iterable<PhotoCatalogPackInput> | AsyncIterable<PhotoCatalogPackInput>,
	ports: PhotoManagedImportPortsV1,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<readonly PhotoManagedImportReceiptV1[]> {
	const catalog = id(catalogId, 'catalog ID');
	return (ports.exclusive ?? withPhotoCatalogWriteLockV1)(catalog, async (signal) => {
		await recoverIntent(catalog, ports, signal);
		const root = await ports.catalog.loadCatalog(catalog);
		if (!root) throw new ReferenceError('Photo catalog is missing.');
		const intent = normalizePhotoImportIntentV1({ schemaVersion: 1, kind: 'photo-import', catalogId: catalog,
			importId: (ports.createImportId ?? (() => `import-${crypto.randomUUID()}`))() }, catalog);
		signal?.throwIfAborted();
		if (!await ports.journal.putIfAbsent(photoImportIntentKeyV1(catalog), intent)) throw new Error('Another photo import intent is active.');
		const results: PhotoManagedImportReceiptV1[] = [];
		let totalBytes = 0;
		for await (const value of photos) {
			signal?.throwIfAborted();
			if (results.length >= IMAGE_IMPORT_LIMITS.maximumFilesPerGesture) throw new RangeError('Photo publication exceeds its gesture file bound.');
			let candidate: PhotoDocumentV1 | undefined;
			let reusedOriginal = false;
			try {
				const input = readClosedDomainRecord(value, 'managed photo input', ['photo', 'original']);
				const document = validateLightscaperDocumentV1(readClosedDomainField(input, 'photo', 'managed photo input'));
				if (document.kind !== 'photo' || document.catalogId !== catalog || document.revision !== 0) throw new RangeError('Managed import requires an initial photo in the selected catalog.');
				validatePhotoCatalogReferencesV1(document, root);
				if (await ports.catalog.loadPhoto(catalog, document.id)) throw new RangeError('Photo identity already exists in the selected catalog.');
				const original = canonicalMediaContentBlob(readClosedDomainField(input, 'original', 'managed photo input'));
				totalBytes += original.size;
				if (original.size < 1 || original.size > IMAGE_IMPORT_LIMITS.maximumFileInputBytes
					|| totalBytes > IMAGE_IMPORT_LIMITS.maximumGestureInputBytes || original.size !== document.original.byteLength) throw new RangeError('Managed original exceeds its admitted byte bounds.');
				const retained = await prepareOriginal(document, original, ports, signal);
				candidate = retained.photo; reusedOriginal = retained.reused;
				await ports.media.custody.stage(catalog, intent.importId, [retained.reference], { signal });
				signal?.throwIfAborted();
				const current = await ports.catalog.loadCatalog(catalog);
				if (!current) throw new ReferenceError('Photo catalog is missing.');
				await ports.catalog.publishPhotos(catalog, current.revision, [candidate], { signal });
				signal?.throwIfAborted();
				await ports.media.custody.promote(catalog, intent.importId, [candidate.id], { signal });
				results.push(receipt(results.length, candidate.id, reusedOriginal));
			} catch (error) {
				signal?.throwIfAborted();
				await settlePhotoImportRootsV1(intent, ports, signal);
				const stored = candidate ? await ports.catalog.loadPhoto(catalog, candidate.id) : null;
				if (stored && candidate && sameImportIdentity(stored, candidate)) {
					results.push(receipt(results.length, candidate.id, reusedOriginal));
				} else results.push(Object.freeze({ index: results.length, photoId: candidate?.id ?? null,
					status: 'failed', reusedOriginal, message: failureMessage(error) }));
			}
		}
		signal?.throwIfAborted();
		await settlePhotoImportRootsV1(intent, ports, signal);
		await retireIntent(intent, ports);
		return Object.freeze(results);
	}, options.signal);
}

export async function recoverManagedPhotoImportV1(catalogId: string, ports: PhotoManagedImportPortsV1,
	options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> {
	const catalog = id(catalogId, 'catalog ID');
	await (ports.exclusive ?? withPhotoCatalogWriteLockV1)(catalog, (signal) => recoverIntent(catalog, ports, signal), options.signal);
}

async function recoverIntent(catalogId: string, ports: PhotoManagedImportPortsV1, signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	const value = await ports.journal.get(photoImportIntentKeyV1(catalogId));
	if (value === undefined) return;
	const intent = normalizePhotoImportIntentV1(value, catalogId);
	await settlePhotoImportRootsV1(intent, ports, signal);
	signal?.throwIfAborted();
	await retireIntent(intent, ports);
}

async function retireIntent(intent: PhotoImportIntentV1, ports: PhotoManagedImportPortsV1): Promise<void> {
	if (!await ports.journal.deleteIfCurrent(photoImportIntentKeyV1(intent.catalogId), intent)) throw new Error('The photo import intent changed before retirement.');
}

async function prepareOriginal(photo: PhotoDocumentV1, original: Blob,
	ports: PhotoManagedImportPortsV1, signal?: AbortSignal): Promise<Readonly<{ photo: PhotoDocumentV1; reused: boolean; reference: CatalogOriginalReferenceV1 }>> {
	if (await digestMediaContent(original, { signal }) !== photo.original.contentSha256) throw new Error('Selected photo original digest differs from its verified preparation.');
	let afterAssetId: string | null = null;
	let assetId: string | null;
	do {
		signal?.throwIfAborted();
		const page = await ports.media.custody.findDigestPage(photo.original.contentSha256, afterAssetId, { signal });
		assetId = page.matches.find((match) => match.size === original.size)?.assetId ?? null;
		afterAssetId = page.afterAssetId;
	} while (assetId === null && afterAssetId !== null);
	const reused = assetId !== null;
	if (assetId === null) {
		assetId = photo.original.storageKey;
		const stored = await ports.media.writeAsset(assetId, original, { name: photo.original.name, mimeType: photo.original.mimeType }, { signal });
		if (stored.sha256 !== photo.original.contentSha256 || stored.size !== original.size) throw new Error('Stored photo original differs from its verified preparation.');
	}
	const reference: CatalogOriginalReferenceV1 = { photoId: photo.id, sourceId: photo.original.id,
		assetId, sha256: photo.original.contentSha256, size: original.size };
	return Object.freeze({ reused, reference, photo: normalizePhotoDocumentV1({ ...photo, original: { ...photo.original, storageKey: assetId } }) });
}

function sameImportIdentity(stored: PhotoDocumentV1, candidate: PhotoDocumentV1): boolean {
	return stored.catalogId === candidate.catalogId && stored.id === candidate.id
		&& JSON.stringify(stored.original) === JSON.stringify(candidate.original)
		&& JSON.stringify(stored.extractedMetadata) === JSON.stringify(candidate.extractedMetadata);
}

function receipt(index: number, photoId: string, reusedOriginal: boolean): PhotoManagedImportReceiptV1 {
	return Object.freeze({ index, photoId, status: 'imported', reusedOriginal, message: null });
}

function failureMessage(error: unknown): string {
	const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'message') : undefined;
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
		? descriptor.value.slice(0, 2_048) : 'Photo import failed.';
}
