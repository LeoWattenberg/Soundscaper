/* SPDX-License-Identifier: AGPL-3.0-only */

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

	async readQueryPage(catalogId: string, options: PhotoQueryPageRequestV1 = {}): Promise<PhotoQueryPageV1> {
		return readPhotoQueryPageV1(await this.#open(), catalogId, options);
	}

	async rebuildQueryIndexPage(catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		return rebuildPhotoQueryIndexPageV1(await this.#open(), catalogId, options.signal);
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
