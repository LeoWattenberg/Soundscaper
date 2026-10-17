/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPhotoSmartCollectionQueryPageV1, readPhotoSmartCollectionStackQueryPageV1 } from './photo-smart-collection-query-v1.ts';
import { admitPhotoSavedQueryPageRequestV1, type PhotoSavedQueryPageRequestV1 } from './photo-smart-collection-query-types-v1.ts';
import { admitPhotoSmartCollectionSnapshotRequestV1, readPhotoSmartCollectionSnapshotV1 } from './photo-smart-collection-snapshot-v1.ts';
import { admitPhotoSmartCollectionArchiveContextRequestV1, readPhotoSmartCollectionArchiveContextV1 } from './photo-smart-collection-archive-context-v1.ts';
import { capturePhotoSmartCollectionArchiveV1 } from './photo-smart-collection-archive-capture-v1.ts';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { openPhotoCatalogDatabaseV1 } from './catalog-database.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1, serializeLightscaperDocumentV1 } from './documents.ts';
import { photoMemberships, photoStorageKey, readStoredPhoto } from './repository-records.ts';
import { readCatalogSummaryPageV1, type PhotoSummaryPageRequestV1 } from './repository-pages.ts';
import { readCatalogSnapshotV1, type PhotoCatalogSnapshotV1 } from './repository-snapshot.ts';
import { createCatalog, publishPhotos, saveCatalog, savePhoto } from './repository-writes.ts';
import { PhotoCatalogClosedError, PHOTO_CATALOG_REPOSITORY_LIMITS as LIMITS, type PhotoCatalogRepositoryOptionsV1, type PhotoSummaryPageV1 } from './repository-types.ts';
import type { PhotoCatalogRootV1, PhotoDocumentV1 } from './types.ts';
import { array, id, integer, name, unique } from './value-validation.ts';
import { readPhotoQueryPageV1 } from './photo-query-pages-v1.ts';
import { rebuildPhotoQueryIndexPageV1 } from './photo-query-rebuild-v1.ts';
import type { PhotoQueryPageRequestV1, PhotoQueryPageV1 } from './photo-query-types-v1.ts';
import { readPhotoQueryPageV2 } from './photo-query-pages-v2.ts';
import { rebuildPhotoQueryIndexPageV2 } from './photo-query-rebuild-v2.ts';
import { readPhotoStackQueryPageV2 } from './photo-stack-query-v2.ts';
import { admitPhotoStackQueryPageRequestV2, type PhotoStackQueryPageRequestV2 } from './photo-stack-query-types-v2.ts';
import { admitPhotoQueryPageRequestV2, type PhotoQueryPageRequestV2 } from './photo-query-types-v2.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { admitPhotoSmartCollectionSaveV1, readPhotoSmartCollectionWriteOptionsV1, readPhotoSmartCollectionSignalOptionsV1,
	readPhotoSmartCollectionPageOptionsV1, smartCollectionRevisionV1, type PhotoSmartCollectionWriteOptionsV1,
	type PhotoSmartCollectionSignalOptionsV1, type PhotoSmartCollectionPageOptionsV1 } from './photo-smart-collection-repository-types-v1.ts';
import { loadPhotoSmartCollectionV1, readPhotoSmartCollectionStateV1, savePhotoSmartCollectionV1,
	deletePhotoSmartCollectionV1, withPhotoSmartCollectionWriteSignalV1 } from './photo-smart-collection-repository-v1.ts';
import { readPhotoSmartCollectionPageV1 } from './photo-smart-collection-pages-v1.ts';
import { readPhotoStackQueryPageV1 } from './photo-stack-query-pages-v1.ts';
import { admitPhotoStackQueryPageRequestV1, type PhotoStackQueryPageRequestV1 } from './photo-stack-query-types-v1.ts';
import { admitPhotoStackSaveV1, admitPhotoStackMemberIdsV1, readPhotoStackWriteOptionsV1, readPhotoStackPageOptionsV1, readPhotoStackSignalOptionsV1,
	loadPhotoStackV1, readPhotoStackStateV1, readPhotoStackPageV1, readPhotoStackMembershipPageV1, readPhotoStackMemberPageV1, savePhotoStackV1, dissolvePhotoStackV1,
	type PhotoStackWriteOptionsV1, type PhotoStackPageOptionsV1, type PhotoStackMembershipPageOptionsV1 } from './photo-stack-repository-v1.ts';

/** Durable metadata repository, independent of the audio/timeline project facade. */
export class PhotoCatalogRepositoryV1 {
	readonly #options: PhotoCatalogRepositoryOptionsV1;
	readonly #databaseName: string;
	#database: Promise<IDBDatabase> | null = null;
	#closed = false;

	constructor(options: PhotoCatalogRepositoryOptionsV1) {
		if (!options.indexedDB || typeof options.indexedDB.open !== 'function') throw new TypeError('A durable IndexedDB factory is required.');
		if (typeof options.verifyOriginal !== 'function') throw new TypeError('Original custody verification is required.');
		this.#options = options;
		this.#databaseName = name(options.databaseName ?? 'lightscaper-photo-catalog-v1', 'photo catalog database name');
	}

	async createCatalog(value: unknown): Promise<void> {
		const document = validateLightscaperDocumentV1(value);
		if (document.kind !== 'photo-catalog') throw new TypeError('Catalog creation requires a root document.');
		await createCatalog(await this.#open(), document);
	}

	async loadCatalog(catalogId: string): Promise<PhotoCatalogRootV1 | null> {
		const key = id(catalogId, 'catalog ID');
		return catalogTransaction(await this.#open(), ['catalogs'], 'readonly', async (stores) => {
			const value: unknown = await request(stores.catalogs.get(key));
			if (value === undefined) return null;
			const document = validateLightscaperDocumentV1(value);
			if (document.kind !== 'photo-catalog' || document.id !== key) throw new TypeError('Stored catalog identity disagrees with its key.');
			return document;
		});
	}

	async loadPhoto(catalogId: string, photoId: string): Promise<PhotoDocumentV1 | null> {
		const key = photoStorageKey(catalogId, photoId);
		return catalogTransaction(await this.#open(), ['photos'], 'readonly', async (stores) => {
			const value: unknown = await request(stores.photos.get(key));
			return value === undefined ? null : readStoredPhoto(value);
		});
	}

	async readSnapshot(catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoCatalogSnapshotV1 | null> {
		return readCatalogSnapshotV1(await this.#open(), catalogId, options);
	}

	async captureSmartCollectionArchiveV1(catalogId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		const admitted = admitPhotoSmartCollectionArchiveContextRequestV1(catalogId, options);
		return capturePhotoSmartCollectionArchiveV1(await this.#open(), admitted.catalogId, { signal: admitted.signal });
	}

	async publishPhotos(catalogId: string, expectedRevision: number, values: readonly unknown[], options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoCatalogRootV1> {
		if (this.#closed) throw new PhotoCatalogClosedError();
		const rootId = id(catalogId, 'catalog ID');
		const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'catalog expected revision');
		const photos = array(values, 'catalog import batch', 1, LIMITS.maximumImportPhotos).map(readPhoto);
		unique(photos.map((photo) => photo.id), 'catalog import photos');
		let bytes = 0;
		let memberships = 0;
		for (const photo of photos) {
			if (photo.catalogId !== rootId || photo.revision !== 0) throw new RangeError('Imported photos require the selected catalog and initial revision zero.');
			bytes += new TextEncoder().encode(serializeLightscaperDocumentV1(photo)).byteLength;
			memberships += photoMemberships(photo).length;
		}
		if (bytes > LIMITS.maximumImportBytes || memberships > LIMITS.maximumMembershipWrites) throw new RangeError('Catalog import batch exceeds its byte or membership write budget; split the batch.');
		for (const photo of photos) {
			assertNotAborted(options.signal);
			await this.#options.verifyOriginal(photo.original, options.signal);
		}
		assertNotAborted(options.signal);
		return publishPhotos(await this.#open(), rootId, expected, photos, options.signal);
	}

	async savePhoto(value: unknown, expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoDocumentV1> {
		const photo = readPhoto(value);
		const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'photo expected revision');
		if (photo.revision !== expected) throw new RangeError('Photo candidate revision disagrees with its expected revision.');
		return savePhoto(await this.#open(), photo, expected, options.signal);
	}

	async saveCatalog(value: unknown, expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoCatalogRootV1> {
		const root = validateLightscaperDocumentV1(value);
		if (root.kind !== 'photo-catalog') throw new TypeError('Catalog editing requires a root document.');
		const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'catalog expected revision');
		if (root.revision !== expected) throw new RangeError('Catalog candidate revision disagrees with its expected revision.');
		return saveCatalog(await this.#open(), root, expected, options.signal);
	}

	async readSummaryPage(catalogId: string, options: PhotoSummaryPageRequestV1 = {}): Promise<PhotoSummaryPageV1> {
		return readCatalogSummaryPageV1(await this.#open(), catalogId, options);
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		try { (await this.#database)?.close(); } catch { /* A failed open has no live database to close. */ }
	}

	async loadStack(catalogId: string, stackId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		const catalog = id(catalogId, 'catalog ID'); const stack = id(stackId, 'stack ID'); const admitted = readPhotoStackSignalOptionsV1(options);
		return loadPhotoStackV1(await this.#open(), catalog, stack, admitted);
	}

	async readStackState(catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		const catalog = id(catalogId, 'catalog ID'); const admitted = readPhotoStackSignalOptionsV1(options);
		return readPhotoStackStateV1(await this.#open(), catalog, admitted);
	}

	async readStackPage(catalogId: string, options: PhotoStackPageOptionsV1 = {}) {
		const catalog = id(catalogId, 'catalog ID'); const admitted = readPhotoStackPageOptionsV1(options, catalog, 'stacks');
		return readPhotoStackPageV1(await this.#open(), catalog, admitted);
	}

	async readStackMembershipPage(catalogId: string, options: PhotoStackMembershipPageOptionsV1 = {}) {
		const catalog = id(catalogId, 'catalog ID'); const admitted = readPhotoStackPageOptionsV1(options, catalog, 'memberships');
		return readPhotoStackMembershipPageV1(await this.#open(), catalog, admitted);
	}

	async saveStack(value: unknown, expectedStackRevision: number | null, options: PhotoStackWriteOptionsV1) {
		const candidate = admitPhotoStackSaveV1(value, expectedStackRevision); const admitted = readPhotoStackWriteOptionsV1(options);
		return savePhotoStackV1(await this.#open(), candidate, expectedStackRevision, admitted);
	}

	async readStackMemberPage(catalogId: string, stackId: string, expectedStackRevision: number, photoIds: readonly string[], options: Readonly<{ signal?: AbortSignal }> = {}) {
		const catalog = id(catalogId, 'catalog ID'), stack = id(stackId, 'stack ID'), expected = integer(expectedStackRevision, 0, Number.MAX_SAFE_INTEGER, 'stack expected revision');
		const selected = admitPhotoStackMemberIdsV1(photoIds), admitted = readPhotoStackSignalOptionsV1(options);
		return readPhotoStackMemberPageV1(await this.#open(), catalog, stack, expected, selected, admitted);
	}

	async dissolveStack(catalogId: string, stackId: string, expectedStackRevision: number, options: PhotoStackWriteOptionsV1) {
		const catalog = id(catalogId, 'catalog ID'); const stack = id(stackId, 'stack ID');
		const expected = integer(expectedStackRevision, 0, Number.MAX_SAFE_INTEGER, 'stack expected revision'); const admitted = readPhotoStackWriteOptionsV1(options);
		return dissolvePhotoStackV1(await this.#open(), catalog, stack, expected, admitted);
	}

	async readQueryPage(catalogId: string, options: PhotoQueryPageRequestV1 = {}): Promise<PhotoQueryPageV1> {
		return readPhotoQueryPageV1(await this.#open(), catalogId, options);
	}

	async readQueryPageV2(catalogId: string, options: PhotoQueryPageRequestV2 = {}) {
		const catalog = id(catalogId, 'metadata query catalog ID'), admitted = admitPhotoQueryPageRequestV2(catalog, options);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal =>
			readPhotoQueryPageV2(await this.#open(), catalog, { ...admitted, signal }));
	}

	async rebuildQueryIndexPageV2(catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		const catalog = id(catalogId, 'metadata query catalog ID'), admitted = readPhotoStackSignalOptionsV1(options);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal =>
			rebuildPhotoQueryIndexPageV2(await this.#open(), catalog, signal));
	}

	async readStackQueryPage(catalogId: string, options: PhotoStackQueryPageRequestV1 = {}) {
		const catalog = id(catalogId, 'collapsed query catalog ID'), admitted = admitPhotoStackQueryPageRequestV1(catalog, options);
		return readPhotoStackQueryPageV1(await this.#open(), catalog, admitted);
	}
	async readStackQueryPageV2(catalogId: string, options: PhotoStackQueryPageRequestV2 = {}) {
		const catalog = id(catalogId, 'collapsed metadata catalog ID'), admitted = admitPhotoStackQueryPageRequestV2(catalog, options);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoStackQueryPageV2(await this.#open(), catalog, { ...admitted, signal }));
	}

	async rebuildQueryIndexPage(catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		return rebuildPhotoQueryIndexPageV1(await this.#open(), catalogId, options.signal);
	}

	async saveSmartCollection(value: unknown, expectedRevision: number | null, options: PhotoSmartCollectionWriteOptionsV1) {
		const candidate = admitPhotoSmartCollectionSaveV1(value, expectedRevision), admitted = readPhotoSmartCollectionWriteOptionsV1(options);
		return withPhotoSmartCollectionWriteSignalV1(admitted.signal, async signal => savePhotoSmartCollectionV1(await this.#open(), candidate, expectedRevision, { ...admitted, signal }));
	}
	async deleteSmartCollection(catalogId: string, collectionId: string, expectedRevision: number, options: PhotoSmartCollectionWriteOptionsV1) {
		const catalog = id(catalogId, 'saved collection catalog ID'), collection = id(collectionId, 'saved collection ID');
		const expected = smartCollectionRevisionV1(expectedRevision), admitted = readPhotoSmartCollectionWriteOptionsV1(options);
		return withPhotoSmartCollectionWriteSignalV1(admitted.signal, async signal => deletePhotoSmartCollectionV1(await this.#open(), catalog, collection, expected, { ...admitted, signal }));
	}
	async loadSmartCollection(catalogId: string, collectionId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		const catalog = id(catalogId, 'saved collection catalog ID'), collection = id(collectionId, 'saved collection ID'), admitted = readPhotoSmartCollectionSignalOptionsV1(options);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal => loadPhotoSmartCollectionV1(await this.#open(), catalog, collection, { signal }));
	}
	async readSmartCollectionState(catalogId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		const catalog = id(catalogId, 'saved collection catalog ID'), admitted = readPhotoSmartCollectionSignalOptionsV1(options);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionStateV1(await this.#open(), catalog, { signal }));
	}
	async readSmartCollectionArchiveContextV1(catalogId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		const admitted = admitPhotoSmartCollectionArchiveContextRequestV1(catalogId, options);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal =>
			readPhotoSmartCollectionArchiveContextV1(await this.#open(), admitted.catalogId, { signal }));
	}
	async readSmartCollectionSnapshotV1(catalogId: string, selectedId: string | null, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		const admitted = admitPhotoSmartCollectionSnapshotRequestV1(catalogId, selectedId, options);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionSnapshotV1(await this.#open(),
			admitted.catalogId, admitted.selectedId, { signal }));
	}
	async readSmartCollectionPage(catalogId: string, options: PhotoSmartCollectionPageOptionsV1 = {}) {
		const catalog = id(catalogId, 'saved collection catalog ID'), admitted = readPhotoSmartCollectionPageOptionsV1(options, catalog);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionPageV1(await this.#open(), catalog, { ...admitted, signal }));
	}
	async readSmartCollectionQueryPageV1(catalogId: string, collectionId: string, options: PhotoSavedQueryPageRequestV1 = {}) {
		const admitted = admitPhotoSavedQueryPageRequestV1(catalogId, collectionId, 'ordinary', options);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionQueryPageV1(await this.#open(),
			admitted.catalogId, admitted.collectionId, { continuation: admitted.continuation, signal }));
	}
	async readSmartCollectionStackQueryPageV1(catalogId: string, collectionId: string, options: PhotoSavedQueryPageRequestV1 = {}) {
		const admitted = admitPhotoSavedQueryPageRequestV1(catalogId, collectionId, 'collapsed', options);
		return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionStackQueryPageV1(await this.#open(),
			admitted.catalogId, admitted.collectionId, { continuation: admitted.continuation, signal }));
	}

	async #open(): Promise<IDBDatabase> {
		if (this.#closed) throw new PhotoCatalogClosedError();
		this.#database ??= openPhotoCatalogDatabaseV1(this.#options.indexedDB, this.#databaseName, () => { this.#closed = true; });
		const attempt = this.#database;
		try {
			const database = await attempt;
			if (this.#closed) throw new PhotoCatalogClosedError();
			return database;
		} catch (error) {
			if (!this.#closed && this.#database === attempt) this.#database = null;
			throw error;
		}
	}
}

function readPhoto(value: unknown): PhotoDocumentV1 {
	const document = validateLightscaperDocumentV1(value);
	if (document.kind !== 'photo') throw new TypeError('A photo document is required.');
	return document;
}
