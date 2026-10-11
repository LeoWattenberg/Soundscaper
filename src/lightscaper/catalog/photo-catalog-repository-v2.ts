/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPhotoSmartCollectionQueryPageV1, readPhotoSmartCollectionStackQueryPageV1 } from './photo-smart-collection-query-v1.ts';
import { admitPhotoSavedQueryPageRequestV1, type PhotoSavedQueryPageRequestV1 } from './photo-smart-collection-query-types-v1.ts';
import { admitPhotoSmartCollectionSnapshotRequestV1, readPhotoSmartCollectionSnapshotV1 } from './photo-smart-collection-snapshot-v1.ts';
import { admitPhotoSmartCollectionArchiveContextRequestV1, readPhotoSmartCollectionArchiveContextV1 } from './photo-smart-collection-archive-context-v1.ts';
import { capturePhotoSmartCollectionArchiveV1 } from './photo-smart-collection-archive-capture-v1.ts';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { openPhotoCatalogDatabaseV1 } from './catalog-database.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { photoMemberships, photoStorageKey } from './repository-records.ts';
import { readCatalogSummaryPageV1, type PhotoSummaryPageRequestV1 } from './repository-pages.ts';
import { readCatalogSnapshotV1, type PhotoCatalogSnapshotV1 } from './repository-snapshot.ts';
import { createCatalog, saveCatalog } from './repository-writes.ts';
import { publishPhotosV2 as publishPhotos, savePhotoV2 as savePhoto } from './photo-catalog-writes-v2.ts';
import { readStoredPhotoV1OrV2 } from './photo-catalog-records-v2.ts';
import { normalizePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2, type PhotoDocumentV2 } from './photo-document-v2.ts';
import { createPhotoCubeLutReachabilityV1 } from './photo-cube-lut-reachability-v1.ts';
import { createPhotoMaskRasterReachabilityV1 } from './photo-mask-raster-reachability-v1.ts';
import { rebuildPhotoQueryIndexPageForPhotosV2 } from './photo-query-rebuild-photos-v2.ts';
import { PhotoCatalogClosedError, PHOTO_CATALOG_REPOSITORY_LIMITS as LIMITS, type PhotoCatalogRepositoryOptionsV1, type PhotoSummaryPageV1 } from './repository-types.ts';
import type { PhotoCatalogRootV1, PhotoDocumentV1 } from './types.ts';
import { array, id, integer, name, unique } from './value-validation.ts';
import { readPhotoQueryPageV1 } from './photo-query-pages-v1.ts';
import type { PhotoQueryPageRequestV1, PhotoQueryPageV1 } from './photo-query-types-v1.ts';
import { readPhotoQueryPageV2 } from './photo-query-pages-v2.ts';
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
import { admitPhotoCullingNavigationV1, readPhotoCullingDestinationPageV1 } from './photo-culling-navigation-v1.ts';
import type { PhotoLibraryCullingNavigationContextV1, PhotoLibraryCullingNavigationRequestV1 } from '../../common/editor/photo-library-culling-navigation-port-v1.ts';
import { admitPhotoStackQueryPageRequestV1, type PhotoStackQueryPageRequestV1 } from './photo-stack-query-types-v1.ts';
import { admitPhotoStackSaveV1, admitPhotoStackMemberIdsV1, readPhotoStackWriteOptionsV1, readPhotoStackPageOptionsV1, readPhotoStackSignalOptionsV1,
	loadPhotoStackV1, readPhotoStackStateV1, readPhotoStackPageV1, readPhotoStackMembershipPageV1, readPhotoStackMemberPageV1, savePhotoStackV1, dissolvePhotoStackV1,
	type PhotoStackWriteOptionsV1, type PhotoStackPageOptionsV1, type PhotoStackMembershipPageOptionsV1 } from './photo-stack-repository-v1.ts';

type CurrentPhoto = PhotoDocumentV1 | PhotoDocumentV2;
export interface PhotoCatalogRepositoryOptionsV2 extends PhotoCatalogRepositoryOptionsV1 {
	/** Bound to immutable selected-library bodies by the host; called before native writes. */
	readonly verifyResources?: (photo: CurrentPhoto, signal?: AbortSignal) => Promise<void>;
}
const NativeController = AbortController;
const ANY_SIGNAL = AbortSignal.any;

/** Explicit mixed Photo1/2 durable facade; roots and metadata query wire profiles remain V1/V2. */
export class PhotoCatalogRepositoryV2 {
	readonly #options: PhotoCatalogRepositoryOptionsV2;
	readonly #databaseName: string;
	#database: Promise<IDBDatabase> | null = null;
	#closed = false;
	readonly #lifetime = new NativeController();
	readonly #pending = new Set<Promise<unknown>>();
	#closing: Promise<void> | null = null;

	constructor(options: PhotoCatalogRepositoryOptionsV2) {
		if (!options.indexedDB || typeof options.indexedDB.open !== 'function') throw new TypeError('A durable IndexedDB factory is required.');
		const verifyOriginal = options.verifyOriginal, verifyResources = options.verifyResources;
		if (typeof verifyOriginal !== 'function') throw new TypeError('Original custody verification is required.');
		if (verifyResources !== undefined && typeof verifyResources !== 'function') throw new TypeError('Resource verification must be a function.');
		const original: typeof verifyOriginal = (...args) => Reflect.apply(verifyOriginal, options, args);
		const resources = verifyResources === undefined ? undefined : (photo: CurrentPhoto, signal?: AbortSignal) =>
			Reflect.apply(verifyResources, options, [photo, signal] as const);
		this.#options = Object.freeze({ indexedDB: options.indexedDB, verifyOriginal: original,
			...(resources ? { verifyResources: resources } : {}) });
		this.#databaseName = name(options.databaseName ?? 'lightscaper-photo-catalog-v1', 'photo catalog database name');
	}

	async createCatalog(value: unknown): Promise<void> {
		return this.#run(async () => {
			const document = validateLightscaperDocumentV1(value);
			if (document.kind !== 'photo-catalog') throw new TypeError('Catalog creation requires a root document.');
			await createCatalog(await this.#open(), document);
		});
	}

	async loadCatalog(catalogId: string): Promise<PhotoCatalogRootV1 | null> {
		return this.#run(async () => {
			const key = id(catalogId, 'catalog ID');
			return catalogTransaction(await this.#open(), ['catalogs'], 'readonly', async (stores) => {
				const value: unknown = await request(stores.catalogs.get(key));
				if (value === undefined) return null;
				const document = validateLightscaperDocumentV1(value);
				if (document.kind !== 'photo-catalog' || document.id !== key) throw new TypeError('Stored catalog identity disagrees with its key.');
				return document;
			});
		});
	}

	async loadPhoto(catalogId: string, photoId: string): Promise<CurrentPhoto | null> {
		return this.#run(async () => {
			const key = photoStorageKey(catalogId, photoId);
			return catalogTransaction(await this.#open(), ['photos'], 'readonly', async (stores) => {
				const value: unknown = await request(stores.photos.get(key));
				return value === undefined ? null : readStoredPhotoV1OrV2(value, key);
			});
		});
	}

	async readSnapshot(catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoCatalogSnapshotV1 | null> {
		return this.#run(async () => {
			return readCatalogSnapshotV1(await this.#open(), catalogId, options);
		});
	}

	async captureSmartCollectionArchiveV1(catalogId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		return this.#run(async () => {
			const admitted = admitPhotoSmartCollectionArchiveContextRequestV1(catalogId, options);
			return capturePhotoSmartCollectionArchiveV1(await this.#open(), admitted.catalogId, { signal: admitted.signal });
		});
	}

	async publishPhotos(catalogId: string, expectedRevision: number, values: readonly unknown[], options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoCatalogRootV1> {
		return this.#run(async () => {
			if (this.#closed) throw new PhotoCatalogClosedError();
			const rootId = id(catalogId, 'catalog ID');
			const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'catalog expected revision');
			const photos = array(values, 'catalog import batch', 1, LIMITS.maximumImportPhotos).map(readPhoto);
			unique(photos.map((photo) => photo.id), 'catalog import photos');
			let bytes = 0;
			let memberships = 0;
			for (const photo of photos) {
				if (photo.catalogId !== rootId || photo.revision !== 0) throw new RangeError('Imported photos require the selected catalog and initial revision zero.');
				bytes += new TextEncoder().encode(serializePhotoDocumentV1OrV2(photo)).byteLength;
				memberships += photoMemberships(photo).length;
			}
			if (bytes > LIMITS.maximumImportBytes || memberships > LIMITS.maximumMembershipWrites) throw new RangeError('Catalog import batch exceeds its byte or membership write budget; split the batch.');
			return this.#write(options, async signal => {
				for (const photo of photos) {
					assertNotAborted(signal);
					await this.#options.verifyOriginal(photo.original, signal);
					await this.#verifyResources(photo, signal);
				}
				assertNotAborted(signal);
				return publishPhotos(await this.#open(), rootId, expected, photos, signal);
			});
		});
	}

	async savePhoto(value: unknown, expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<CurrentPhoto> {
		return this.#run(async () => {
			const photo = readPhoto(value);
			const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'photo expected revision');
			if (photo.revision !== expected) throw new RangeError('Photo candidate revision disagrees with its expected revision.');
			normalizePhotoDocumentV1OrV2({ ...photo, revision: expected + 1 });
			return this.#write(options, async signal => {
				await this.#verifyResources(photo, signal);
				return savePhoto(await this.#open(), photo, expected, signal);
			});
		});
	}

	async saveCatalog(value: unknown, expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoCatalogRootV1> {
		return this.#run(async () => {
			const root = validateLightscaperDocumentV1(value);
			if (root.kind !== 'photo-catalog') throw new TypeError('Catalog editing requires a root document.');
			const expected = integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'catalog expected revision');
			if (root.revision !== expected) throw new RangeError('Catalog candidate revision disagrees with its expected revision.');
			return saveCatalog(await this.#open(), root, expected, options.signal);
		});
	}

	async readSummaryPage(catalogId: string, options: PhotoSummaryPageRequestV1 = {}): Promise<PhotoSummaryPageV1> {
		return this.#run(async () => {
			return readCatalogSummaryPageV1(await this.#open(), catalogId, options);
		});
	}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closed = true; this.#lifetime.abort();
		this.#closing = (async () => {
			await Promise.allSettled([...this.#pending]);
			const database = await this.#database?.catch(() => null);
			database?.close();
		})();
		return this.#closing;
	}

	async loadStack(catalogId: string, stackId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'catalog ID'); const stack = id(stackId, 'stack ID'); const admitted = readPhotoStackSignalOptionsV1(options);
			return loadPhotoStackV1(await this.#open(), catalog, stack, admitted);
		});
	}

	async readStackState(catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'catalog ID'); const admitted = readPhotoStackSignalOptionsV1(options);
			return readPhotoStackStateV1(await this.#open(), catalog, admitted);
		});
	}

	async readStackPage(catalogId: string, options: PhotoStackPageOptionsV1 = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'catalog ID'); const admitted = readPhotoStackPageOptionsV1(options, catalog, 'stacks');
			return readPhotoStackPageV1(await this.#open(), catalog, admitted);
		});
	}

	async readStackMembershipPage(catalogId: string, options: PhotoStackMembershipPageOptionsV1 = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'catalog ID'); const admitted = readPhotoStackPageOptionsV1(options, catalog, 'memberships');
			return readPhotoStackMembershipPageV1(await this.#open(), catalog, admitted);
		});
	}

	async saveStack(value: unknown, expectedStackRevision: number | null, options: PhotoStackWriteOptionsV1) {
		return this.#run(async () => {
			const candidate = admitPhotoStackSaveV1(value, expectedStackRevision); const admitted = readPhotoStackWriteOptionsV1(options);
			return savePhotoStackV1(await this.#open(), candidate, expectedStackRevision, admitted);
		});
	}

	async readStackMemberPage(catalogId: string, stackId: string, expectedStackRevision: number, photoIds: readonly string[], options: Readonly<{ signal?: AbortSignal }> = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'catalog ID'), stack = id(stackId, 'stack ID'), expected = integer(expectedStackRevision, 0, Number.MAX_SAFE_INTEGER, 'stack expected revision');
			const selected = admitPhotoStackMemberIdsV1(photoIds), admitted = readPhotoStackSignalOptionsV1(options);
			return readPhotoStackMemberPageV1(await this.#open(), catalog, stack, expected, selected, admitted);
		});
	}

	async dissolveStack(catalogId: string, stackId: string, expectedStackRevision: number, options: PhotoStackWriteOptionsV1) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'catalog ID'); const stack = id(stackId, 'stack ID');
			const expected = integer(expectedStackRevision, 0, Number.MAX_SAFE_INTEGER, 'stack expected revision'); const admitted = readPhotoStackWriteOptionsV1(options);
			return dissolvePhotoStackV1(await this.#open(), catalog, stack, expected, admitted);
		});
	}

	async readQueryPage(catalogId: string, options: PhotoQueryPageRequestV1 = {}): Promise<PhotoQueryPageV1> {
		return this.#run(async () => {
			return readPhotoQueryPageV1(await this.#open(), catalogId, options);
		});
	}
	async readCullingDestinationPage(catalogId: string, context: PhotoLibraryCullingNavigationContextV1, options: PhotoLibraryCullingNavigationRequestV1) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'culling catalog ID'), admitted = admitPhotoCullingNavigationV1(context, options);
			const signal = Reflect.apply(ANY_SIGNAL, AbortSignal, [admitted.signal ? [admitted.signal, this.#lifetime.signal] : [this.#lifetime.signal]]) as AbortSignal;
			return withPhotoStackQuerySignalV1(signal, async joined => readPhotoCullingDestinationPageV1(await this.#open(), catalog,
				admitted.context, { photoId: admitted.photoId, signal: joined }));
		});
	}

	async readQueryPageV2(catalogId: string, options: PhotoQueryPageRequestV2 = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'metadata query catalog ID'), admitted = admitPhotoQueryPageRequestV2(catalog, options);
			return withPhotoStackQuerySignalV1(admitted.signal, async signal =>
				readPhotoQueryPageV2(await this.#open(), catalog, { ...admitted, signal }));
		});
	}

	async rebuildQueryIndexPageV2(catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'metadata query catalog ID');
			return this.#write(options, async signal => rebuildPhotoQueryIndexPageForPhotosV2(await this.#open(), catalog, 2, signal));
		});
	}

	async readStackQueryPage(catalogId: string, options: PhotoStackQueryPageRequestV1 = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'collapsed query catalog ID'), admitted = admitPhotoStackQueryPageRequestV1(catalog, options);
			return readPhotoStackQueryPageV1(await this.#open(), catalog, admitted);
		});
	}
	async readStackQueryPageV2(catalogId: string, options: PhotoStackQueryPageRequestV2 = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'collapsed metadata catalog ID'), admitted = admitPhotoStackQueryPageRequestV2(catalog, options);
			return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoStackQueryPageV2(await this.#open(), catalog, { ...admitted, signal }));
		});
	}

	async rebuildQueryIndexPage(catalogId: string, options: Readonly<{ signal?: AbortSignal }> = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'query rebuild catalog ID');
			return this.#write(options, async signal => rebuildPhotoQueryIndexPageForPhotosV2(await this.#open(), catalog, 1, signal));
		});
	}

	async saveSmartCollection(value: unknown, expectedRevision: number | null, options: PhotoSmartCollectionWriteOptionsV1) {
		return this.#run(async () => {
			const candidate = admitPhotoSmartCollectionSaveV1(value, expectedRevision), admitted = readPhotoSmartCollectionWriteOptionsV1(options);
			return withPhotoSmartCollectionWriteSignalV1(admitted.signal, async signal => savePhotoSmartCollectionV1(await this.#open(), candidate, expectedRevision, { ...admitted, signal }));
		});
	}
	async deleteSmartCollection(catalogId: string, collectionId: string, expectedRevision: number, options: PhotoSmartCollectionWriteOptionsV1) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'saved collection catalog ID'), collection = id(collectionId, 'saved collection ID');
			const expected = smartCollectionRevisionV1(expectedRevision), admitted = readPhotoSmartCollectionWriteOptionsV1(options);
			return withPhotoSmartCollectionWriteSignalV1(admitted.signal, async signal => deletePhotoSmartCollectionV1(await this.#open(), catalog, collection, expected, { ...admitted, signal }));
		});
	}
	async loadSmartCollection(catalogId: string, collectionId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'saved collection catalog ID'), collection = id(collectionId, 'saved collection ID'), admitted = readPhotoSmartCollectionSignalOptionsV1(options);
			return withPhotoStackQuerySignalV1(admitted.signal, async signal => loadPhotoSmartCollectionV1(await this.#open(), catalog, collection, { signal }));
		});
	}
	async readSmartCollectionState(catalogId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'saved collection catalog ID'), admitted = readPhotoSmartCollectionSignalOptionsV1(options);
			return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionStateV1(await this.#open(), catalog, { signal }));
		});
	}
	async readSmartCollectionArchiveContextV1(catalogId: string, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		return this.#run(async () => {
			const admitted = admitPhotoSmartCollectionArchiveContextRequestV1(catalogId, options);
			return withPhotoStackQuerySignalV1(admitted.signal, async signal =>
				readPhotoSmartCollectionArchiveContextV1(await this.#open(), admitted.catalogId, { signal }));
		});
	}
	async readSmartCollectionSnapshotV1(catalogId: string, selectedId: string | null, options: PhotoSmartCollectionSignalOptionsV1 = {}) {
		return this.#run(async () => {
			const admitted = admitPhotoSmartCollectionSnapshotRequestV1(catalogId, selectedId, options);
			return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionSnapshotV1(await this.#open(),
				admitted.catalogId, admitted.selectedId, { signal }));
		});
	}
	async readSmartCollectionPage(catalogId: string, options: PhotoSmartCollectionPageOptionsV1 = {}) {
		return this.#run(async () => {
			const catalog = id(catalogId, 'saved collection catalog ID'), admitted = readPhotoSmartCollectionPageOptionsV1(options, catalog);
			return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionPageV1(await this.#open(), catalog, { ...admitted, signal }));
		});
	}
	async readSmartCollectionQueryPageV1(catalogId: string, collectionId: string, options: PhotoSavedQueryPageRequestV1 = {}) {
		return this.#run(async () => {
			const admitted = admitPhotoSavedQueryPageRequestV1(catalogId, collectionId, 'ordinary', options);
			return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionQueryPageV1(await this.#open(),
				admitted.catalogId, admitted.collectionId, { continuation: admitted.continuation, signal }));
		});
	}
	async readSmartCollectionStackQueryPageV1(catalogId: string, collectionId: string, options: PhotoSavedQueryPageRequestV1 = {}) {
		return this.#run(async () => {
			const admitted = admitPhotoSavedQueryPageRequestV1(catalogId, collectionId, 'collapsed', options);
			return withPhotoStackQuerySignalV1(admitted.signal, async signal => readPhotoSmartCollectionStackQueryPageV1(await this.#open(),
				admitted.catalogId, admitted.collectionId, { continuation: admitted.continuation, signal }));
		});
	}

	#run<Result>(run: () => Promise<Result>): Promise<Result> {
		if (this.#closed) return Promise.reject(new PhotoCatalogClosedError());
		let resolve!: (value: Result) => void, reject!: (error: unknown) => void;
		const pending = new Promise<Result>((yes, no) => { resolve = yes; reject = no; });
		this.#pending.add(pending);
		try { void run().then(resolve, reject).finally(() => { this.#pending.delete(pending); }); }
		catch (error) { this.#pending.delete(pending); reject(error); }
		return pending;
	}

	async #verifyResources(photo: CurrentPhoto, signal: AbortSignal | undefined): Promise<void> {
		assertNotAborted(signal);
		const reachability = createPhotoCubeLutReachabilityV1(); reachability.addPhoto(photo);
		const masks = createPhotoMaskRasterReachabilityV1(); masks.addPhoto(photo);
		if (reachability.finish().length === 0 && masks.finish().length === 0) return;
		const verify = this.#options.verifyResources;
		if (!verify) throw new TypeError('Photo resources require selected-library verification.');
		await verify(photo, signal); assertNotAborted(signal);
	}

	async #write<Result>(options: Readonly<{ signal?: AbortSignal }>, run: (signal: AbortSignal | undefined) => Promise<Result>): Promise<Result> {
		const { signal } = readPhotoStackSignalOptionsV1(options);
		const joined = ANY_SIGNAL([this.#lifetime.signal, ...(signal ? [signal] : [])]);
		const receipt: { completed?: { value: Result } } = {};
		try {
			return await withPhotoStackQuerySignalV1(joined, async admitted => {
				const value = await run(admitted); receipt.completed = { value }; return value;
			});
		} catch (error) {
			// The native write's completed ACK is retained across later cancellation.
			if (receipt.completed) return receipt.completed.value;
			throw error;
		}
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

function readPhoto(value: unknown): CurrentPhoto {
	return normalizePhotoDocumentV1OrV2(value);
}
