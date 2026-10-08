/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalMediaContentBlob } from '../../common/editor/storage/media-content-digest.ts';
import { exportPhotoCatalogArchiveV1, type PhotoCatalogArchiveExportResult } from '../archive/catalog-archive-export.ts';
import { measurePhotoCatalogPackRecordV1 } from '../archive/catalog-pack.ts';
import { normalizePhotoCatalogRootV1 } from '../catalog/catalog-root.ts';
import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { photoSummary, readPhotoSummary } from '../catalog/repository-records.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import type { PhotoCatalogSnapshotV1 } from '../catalog/repository-snapshot.ts';
import type { PhotoOriginalV1 } from '../catalog/types.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS, PhotoCatalogRevisionConflictError, type PhotoCatalogContinuationV1 } from '../catalog/repository-types.ts';
import { array, field, id, integer, record } from '../catalog/value-validation.ts';
import { admitPhotoLibraryBackupRequestV1 } from './photo-library-backup-request.ts';

export interface PhotoLibraryBackupPortsV1 {
	readonly catalog: Pick<PhotoCatalogRepositoryV1, 'readSnapshot' | 'readSummaryPage' | 'loadPhoto'>;
	readonly loadOriginal: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
}

/** Caller lends the session/catalog lease until the archive destination settles. */
export async function exportPhotoLibraryBackupV1(catalogValue: unknown, ports: PhotoLibraryBackupPortsV1,
	optionsValue: unknown = {}): Promise<PhotoCatalogArchiveExportResult> {
	const catalogId = id(catalogValue, 'backup catalog ID');
	const options = admitPhotoLibraryBackupRequestV1(optionsValue), signal = options.signal;
	signal?.throwIfAborted();
	const initial = await snapshot();
	return exportPhotoCatalogArchiveV1(initial.catalog, originals(), options);

	async function snapshot(): Promise<PhotoCatalogSnapshotV1> {
		const value = await ports.catalog.readSnapshot(catalogId, { signal }); signal?.throwIfAborted();
		if (value === null) throw new ReferenceError('The photo backup catalog is missing.');
		const input = record(value, 'photo backup snapshot', ['catalog', 'indexRevision']);
		const catalog = normalizePhotoCatalogRootV1(field(input, 'catalog'));
		if (catalog.id !== catalogId) throw new TypeError('Photo backup snapshot belongs to another catalog.');
		return Object.freeze({ catalog, indexRevision: integer(field(input, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'snapshot index revision') });
	}

	async function* originals() {
		let continuation: PhotoCatalogContinuationV1 | null = null, count = 0, pageCount = 0;
		const maximumPages = Math.floor(initial.catalog.photoCount / PHOTO_CATALOG_REPOSITORY_LIMITS.pageSize) + 1;
		do {
			signal?.throwIfAborted();
			if (++pageCount > maximumPages) throw new RangeError('Photo backup enumeration exceeds its catalog page count.');
			const page = record(await ports.catalog.readSummaryPage(catalogId, { continuation, signal }), 'photo backup page', ['items', 'continuation']);
			signal?.throwIfAborted();
			const items = array(field(page, 'items'), 'photo backup summaries', 0, PHOTO_CATALOG_REPOSITORY_LIMITS.pageSize).map(readPhotoSummary);
			let previousKey: string = continuation?.afterKey ?? '';
			for (const summary of items) {
				if (summary.catalogId !== catalogId || summary.key <= previousKey) throw new TypeError('Photo backup summary order or catalog identity differs from its page.');
				previousKey = summary.key;
				if (++count > initial.catalog.photoCount) throw new RangeError('Photo backup enumeration exceeds its catalog count.');
				signal?.throwIfAborted();
				const value = await ports.catalog.loadPhoto(catalogId, summary.photoId); signal?.throwIfAborted();
				if (value === null) throw new ReferenceError('The photo backup aggregate is missing.');
				const photo = normalizePhotoDocumentV1(value);
				if (JSON.stringify(photoSummary(photo)) !== JSON.stringify(summary)) throw new PhotoCatalogRevisionConflictError('photo');
				measurePhotoCatalogPackRecordV1(photo);
				const body = await ports.loadOriginal(photo.original, signal); signal?.throwIfAborted();
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
		const current = await snapshot();
		if (current.indexRevision !== initial.indexRevision || JSON.stringify(current.catalog) !== JSON.stringify(initial.catalog)) {
			throw new PhotoCatalogRevisionConflictError('catalog');
		}
	}
}
