/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { measurePhotoCatalogPackRecordV2, type PhotoCatalogPackInputV2 } from '../archive/catalog-pack-v2.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import { photoSummary, readPhotoSummary } from '../catalog/repository-records.ts';
import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import type { PhotoCatalogSnapshotV1 } from '../catalog/repository-snapshot.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS, PhotoCatalogRevisionConflictError, type PhotoCatalogContinuationV1 } from '../catalog/repository-types.ts';
import { array, field, id, integer, record } from '../catalog/value-validation.ts';

export interface PhotoLibraryBackupSourcePortsV2 {
	readonly catalog: Pick<PhotoCatalogRepositoryV2, 'readSnapshot' | 'readSummaryPage' | 'loadPhoto'>;
	readonly loadOriginal: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
}
export interface PhotoLibraryBackupSourceV2 {
	readonly initial: PhotoCatalogSnapshotV1;
	readonly originals: AsyncIterable<PhotoCatalogPackInputV2>;
	readonly verifyCatalog: () => Promise<void>;
}

/** Borrow an admitted signal and existing repositories; no resource or writer is acquired. */
export async function capturePhotoLibraryBackupSourceV2(catalogValue: unknown, ports: PhotoLibraryBackupSourcePortsV2,
	signal?: AbortSignal): Promise<PhotoLibraryBackupSourceV2> {
	const catalogId = id(catalogValue, 'backup catalog ID'); check(signal);
	const catalogPort = ports.catalog, readSnapshot = catalogPort.readSnapshot, readSummaryPage = catalogPort.readSummaryPage, loadPhoto = catalogPort.loadPhoto, loadOriginal = ports.loadOriginal;
	if ([readSnapshot, readSummaryPage, loadPhoto, loadOriginal].some(method => typeof method !== 'function')) throw new TypeError('Current backup source capabilities are required.');
	const initial = await snapshot();
	return Object.freeze({ initial, originals: originals(), verifyCatalog });

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

	async function* originals() {
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
				measurePhotoCatalogPackRecordV2(photo);
				const body = await Reflect.apply(loadOriginal, ports, [photo.original, signal]); check(signal);
				if (body === null || body === undefined) throw new ReferenceError('The photo backup original is missing.');
				const original = canonicalMediaContentBlob(body);
				if (original.size !== photo.original.byteLength) throw new RangeError('The photo backup original byte length differs from its binding.');
				yield Object.freeze({ photo, original });
			}
			const cursor = field(page, 'continuation');
			if (cursor === null) { continuation = null; }
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
function check(signal?: AbortSignal): void { if (signal) Reflect.apply(CHECK, signal, []); }
