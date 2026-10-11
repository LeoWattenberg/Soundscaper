/* SPDX-License-Identifier: AGPL-3.0-only */

import { measurePhotoCatalogPackRecordV2 } from '../archive/catalog-pack-v2.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { normalizePhotoDocumentV1OrV2, type PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { assertPhotoMaskRasterPortableV1 } from '../catalog/photo-mask-raster-portability-v1.ts';
import { photoSummary, readPhotoSummary } from '../catalog/repository-records.ts';
import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import type { PhotoCatalogSnapshotV1 } from '../catalog/repository-snapshot.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS, PhotoCatalogRevisionConflictError, type PhotoCatalogContinuationV1 } from '../catalog/repository-types.ts';
import { array, field, id, integer, record } from '../catalog/value-validation.ts';

export type PhotoLibraryBackupMetadataCatalogV1 = Pick<PhotoCatalogRepositoryV2, 'readSnapshot' | 'readSummaryPage' | 'loadPhoto'>;
export interface PhotoLibraryBackupMetadataPreflightV1 {
	readonly initial: PhotoCatalogSnapshotV1;
	readonly photos: () => AsyncIterable<PhotoDocumentV1 | PhotoDocumentV2>;
	readonly verifyCatalog: () => Promise<void>;
}

/** Complete body-free metadata admission precedes an exportable source.
 * Retain only the root, one <=64-summary page and one transient full Photo.
 * Lazy originals reuse this captured walk instead of a Photo/body cache.
 * The caller owns the selected operation and its joined native reads. */
export async function capturePhotoLibraryBackupMetadataPreflightV1(catalogValue: unknown,
	catalogPort: PhotoLibraryBackupMetadataCatalogV1, signal?: AbortSignal): Promise<Readonly<PhotoLibraryBackupMetadataPreflightV1>> {
	const catalogId = id(catalogValue, 'backup catalog ID'); check(signal);
	const readSnapshot = catalogPort.readSnapshot, readSummaryPage = catalogPort.readSummaryPage, loadPhoto = catalogPort.loadPhoto;
	if ([readSnapshot, readSummaryPage, loadPhoto].some(method => typeof method !== 'function')) throw new TypeError('Current backup metadata capabilities are required.');
	const initial = await snapshot();
	// Admission happens in the shared walk; this preflight retains no Photo.
	for await (const photo of photos()) {
		check(signal);
		if (photo.catalogId !== catalogId) throw new TypeError('Photo backup metadata belongs to another catalog.');
	}
	return Object.freeze({ initial, photos, verifyCatalog });

	async function verifyCatalog(): Promise<void> {
		const current = await snapshot();
		if (current.indexRevision !== initial.indexRevision || JSON.stringify(current.catalog) !== JSON.stringify(initial.catalog)) {
			throw new PhotoCatalogRevisionConflictError('catalog');
		}
	}

	async function snapshot(): Promise<PhotoCatalogSnapshotV1> {
		const value = await Reflect.apply(readSnapshot, catalogPort, [catalogId, { signal }]); check(signal);
		if (value === null) throw new ReferenceError('The photo backup catalog is missing.');
		const input = record(value, 'photo backup snapshot', ['catalog', 'indexRevision']);
		const catalog = readValidatedPhotoCatalogRootV1(field(input, 'catalog'));
		if (catalog.id !== catalogId) throw new TypeError('Photo backup snapshot belongs to another catalog.');
		return Object.freeze({ catalog, indexRevision: integer(field(input, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'snapshot index revision') });
	}

	async function* photos(): AsyncGenerator<PhotoDocumentV1 | PhotoDocumentV2> {
		await verifyCatalog();
		let continuation: PhotoCatalogContinuationV1 | null = null, count = 0, pageCount = 0;
		const maximumPages = Math.floor(initial.catalog.photoCount / PHOTO_CATALOG_REPOSITORY_LIMITS.pageSize) + 1;
		do {
			check(signal);
			if (++pageCount > maximumPages) throw new RangeError('Photo backup enumeration exceeds its catalog page count.');
			const page = record(await Reflect.apply(readSummaryPage, catalogPort, [catalogId, { continuation, signal }]), 'photo backup page', ['items', 'continuation']);
			check(signal);
			const items = array(field(page, 'items'), 'photo backup summaries', 0, PHOTO_CATALOG_REPOSITORY_LIMITS.pageSize).map(readPhotoSummary);
			let previousKey: string = continuation?.afterKey ?? '';
			for (const summary of items) {
				if (summary.catalogId !== catalogId || summary.key <= previousKey) throw new TypeError('Photo backup summary order or catalog identity differs from its page.');
				previousKey = summary.key;
				if (++count > initial.catalog.photoCount) throw new RangeError('Photo backup enumeration exceeds its catalog count.');
				check(signal);
				const value = await Reflect.apply(loadPhoto, catalogPort, [catalogId, summary.photoId]); check(signal);
				if (value === null) throw new ReferenceError('The photo backup aggregate is missing.');
				const photo = normalizePhotoDocumentV1OrV2(value);
				if (JSON.stringify(photoSummary(photo)) !== JSON.stringify(summary)) throw new PhotoCatalogRevisionConflictError('photo');
				assertPhotoMaskRasterPortableV1(photo);
				measurePhotoCatalogPackRecordV2(photo); check(signal);
				yield photo;
			}
			const cursor = field(page, 'continuation');
			if (cursor === null) continuation = null;
			else {
				const input = record(cursor, 'photo backup continuation', ['catalogId', 'indexRevision', 'scope', 'afterKey']);
				if (items.length !== PHOTO_CATALOG_REPOSITORY_LIMITS.pageSize || field(input, 'catalogId') !== catalogId
					|| field(input, 'scope') !== `${catalogId}|all` || field(input, 'indexRevision') !== initial.indexRevision
					|| field(input, 'afterKey') !== previousKey) throw new PhotoCatalogRevisionConflictError('catalog');
				continuation = Object.freeze({ catalogId, indexRevision: initial.indexRevision, scope: `${catalogId}|all`, afterKey: previousKey });
			}
		} while (continuation !== null);
		if (count !== initial.catalog.photoCount) throw new RangeError('Photo backup enumeration differs from its catalog count.');
		await verifyCatalog();
	}
}

const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal?: AbortSignal): void { if (signal !== undefined) Reflect.apply(CHECK, signal, []); }
