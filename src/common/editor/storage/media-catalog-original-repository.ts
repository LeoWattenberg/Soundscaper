/* SPDX-License-Identifier: AGPL-3.0-only */

import { readCursorPage, request, transact } from './indexeddb-backend.ts';
import { trustedMediaContentSha256 } from './media-content-provenance.ts';
import type { StorageRecord } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import { MediaAssetLifecycleCoordinator } from './media-asset-lifecycle-coordinator.ts';
import { MediaAssetWriteAdmission } from './media-asset-write-admission.ts';
import {
	CATALOG_ORIGINAL_PAGE_SIZE, CATALOG_ORIGINAL_ROOT_STORE_NAME, CATALOG_ORIGINAL_SCOPE_INDEX_NAME,
	MEDIA_ASSET_SHA256_INDEX_NAME, catalogOriginalId, catalogOriginalKey, catalogOriginalPhotoIds,
	catalogOriginalReferences, catalogOriginalScope, normalizeCatalogOriginalRoot,
	type CatalogOriginalRootV1,
} from './media-catalog-original-schema.ts';
import {
	catalogCustodyTransaction, deleteCatalogOriginalRoot, makeCatalogOriginalRoot,
	putCatalogOriginalRoot, throwIfCatalogCustodyAborted,
} from './media-catalog-original-records.ts';

interface CustodyOptions { readonly signal?: AbortSignal }
interface CatalogOriginalPageQueryV1 {
	readonly catalogId: string; readonly importId?: string | null; readonly afterKey?: string | null;
}
export interface CatalogOriginalRootPageV1 {
	readonly roots: readonly Readonly<CatalogOriginalRootV1>[];
	readonly afterKey: string | null;
}
export interface MediaDigestMatchV1 {
	readonly assetId: string;
	readonly sha256: string;
	readonly size: number;
}
export interface MediaDigestPageV1 {
	readonly matches: readonly Readonly<MediaDigestMatchV1>[];
	readonly afterAssetId: string | null;
}

/** Durable scalar custody around original file bytes owned by shared media storage. */
export class MediaCatalogOriginalRepositoryV1 {
	readonly #port: StorageRepositoryPort;
	readonly #lifecycle: MediaAssetLifecycleCoordinator;
	constructor(port: StorageRepositoryPort, lifecycle = new MediaAssetLifecycleCoordinator()) {
		this.#port = port;
		this.#lifecycle = lifecycle;
	}

	retain(catalogId: string, references: unknown, options: CustodyOptions = {}): Promise<void> {
		return this.#run((signal) => this.#retain(catalogOriginalId(catalogId), null, references, { signal }), options.signal);
	}
	stage(catalogId: string, importId: string, references: unknown, options: CustodyOptions = {}): Promise<void> {
		return this.#run((signal) => this.#retain(catalogOriginalId(catalogId), catalogOriginalId(importId), references, { signal }), options.signal);
	}
	release(catalogId: string, photoIds: unknown, options: CustodyOptions = {}): Promise<void> {
		return this.#run((signal) => this.#release(catalogOriginalId(catalogId), null, photoIds, { signal }), options.signal);
	}
	releaseStaged(catalogId: string, importId: string, photoIds: unknown, options: CustodyOptions = {}): Promise<void> {
		return this.#run((signal) => this.#release(catalogOriginalId(catalogId), catalogOriginalId(importId), photoIds, { signal }), options.signal);
	}

	promote(catalogId: string, importId: string, photoIds: unknown, options: CustodyOptions = {}): Promise<void> {
		return this.#run((signal) => this.#promote(catalogId, importId, photoIds, { signal }), options.signal);
	}
	readPage(query: CatalogOriginalPageQueryV1, options: CustodyOptions = {}): Promise<CatalogOriginalRootPageV1> {
		return this.#run((signal) => this.#readPage(query, { signal }), options.signal);
	}
	findDigestPage(sha256: string, afterAssetId: string | null = null, options: CustodyOptions = {}): Promise<MediaDigestPageV1> {
		return this.#run((signal) => this.#findDigestPage(sha256, afterAssetId, { signal }), options.signal);
	}

	async #promote(catalogId: string, importId: string, photoIds: unknown, { signal }: CustodyOptions): Promise<void> {
		const catalog = catalogOriginalId(catalogId);
		const imported = catalogOriginalId(importId);
		const photos = catalogOriginalPhotoIds(photoIds);
		const database = await this.#database(signal);
		await catalogCustodyTransaction(database, async (stores) => {
			for (const photoId of photos) {
				throwIfCatalogCustodyAborted(signal);
				const key = catalogOriginalKey(catalog, imported, photoId);
				const value: unknown = await request(stores[CATALOG_ORIGINAL_ROOT_STORE_NAME].get(key));
				if (value === undefined) throw new Error('The provisional catalog original root is missing.');
				const original = normalizeCatalogOriginalRoot(value);
				const promoted = await makeCatalogOriginalRoot(stores.mediaAssets, catalog, null, original);
				await putCatalogOriginalRoot(stores, promoted);
				await deleteCatalogOriginalRoot(stores, key);
			}
		}, signal);
	}

	async #readPage({ catalogId, importId = null, afterKey = null }: CatalogOriginalPageQueryV1, { signal }: CustodyOptions): Promise<CatalogOriginalRootPageV1> {
		const scope = catalogOriginalScope(catalogOriginalId(catalogId), importId === null ? null : catalogOriginalId(importId));
		if (afterKey !== null && typeof afterKey !== 'string') throw new TypeError('A root continuation must be a string.');
		const database = await this.#database(signal);
		const roots = await transact(database, CATALOG_ORIGINAL_ROOT_STORE_NAME, 'readonly', (stores) => readCursorPage(
			stores[CATALOG_ORIGINAL_ROOT_STORE_NAME].index(CATALOG_ORIGINAL_SCOPE_INDEX_NAME), {
				query: scope, afterPrimaryKey: afterKey ?? undefined, limit: CATALOG_ORIGINAL_PAGE_SIZE,
				project: (value, key) => {
					const root = normalizeCatalogOriginalRoot(value);
					if (root.key !== key || root.scope !== scope) throw new Error('Catalog original root index identity is corrupt.');
					return root;
				},
			}));
		throwIfCatalogCustodyAborted(signal);
		return Object.freeze({ roots: Object.freeze(roots), afterKey: roots.length === CATALOG_ORIGINAL_PAGE_SIZE ? roots.at(-1)?.key ?? null : null });
	}

	async #findDigestPage(sha256: string, afterAssetId: string | null, { signal }: CustodyOptions): Promise<MediaDigestPageV1> {
		if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError('A lowercase SHA-256 digest is required.');
		// Existing shared media keys predate catalog identifier limits. The cursor
		// must still advance over unsupported keys without admitting them as roots.
		if (afterAssetId !== null && typeof afterAssetId !== 'string') throw new TypeError('A media digest continuation must be a string.');
		const database = await this.#database(signal);
		const scanned = await transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => readCursorPage(
			mediaAssets.index(MEDIA_ASSET_SHA256_INDEX_NAME), {
				query: sha256, afterPrimaryKey: afterAssetId ?? undefined, limit: CATALOG_ORIGINAL_PAGE_SIZE,
				project: (value, key) => {
					const record = value as StorageRecord;
					const validId = typeof key === 'string' && key.length > 0 && key.length <= 256 && key.trim() === key;
					const match = validId && record.sourceId === key && trustedMediaContentSha256(record) === sha256
						&& Number.isSafeInteger(record.size) && Number(record.size) >= 0
						? Object.freeze({ assetId: key, sha256, size: Number(record.size) }) : null;
					return { key, match };
				},
			}));
		throwIfCatalogCustodyAborted(signal);
		const lastKey = scanned.at(-1)?.key;
		if (scanned.length === CATALOG_ORIGINAL_PAGE_SIZE && typeof lastKey !== 'string') {
			throw new Error('Unsupported media digest cursor primary key.');
		}
		return Object.freeze({
			matches: Object.freeze(scanned.flatMap(({ match }) => match ? [match] : [])),
			afterAssetId: scanned.length === CATALOG_ORIGINAL_PAGE_SIZE && typeof lastKey === 'string' ? lastKey : null,
		});
	}

	async #retain(catalogId: string, importId: string | null, input: unknown, { signal }: CustodyOptions): Promise<void> {
		const references = catalogOriginalReferences(input);
		catalogOriginalPhotoIds(references.map(({ photoId }) => photoId));
		const database = await this.#database(signal);
		await catalogCustodyTransaction(database, async (stores) => {
			for (const reference of references) {
				throwIfCatalogCustodyAborted(signal);
				await putCatalogOriginalRoot(stores, await makeCatalogOriginalRoot(stores.mediaAssets, catalogId, importId, reference));
			}
		}, signal);
	}

	async #release(catalogId: string, importId: string | null, input: unknown, { signal }: CustodyOptions): Promise<void> {
		const photoIds = catalogOriginalPhotoIds(input);
		const database = await this.#database(signal);
		await catalogCustodyTransaction(database, async (stores) => {
			for (const photoId of photoIds) {
				throwIfCatalogCustodyAborted(signal);
				await deleteCatalogOriginalRoot(stores, catalogOriginalKey(catalogId, importId, photoId));
			}
		}, signal);
	}

	async #database(signal?: AbortSignal): Promise<IDBDatabase> {
		throwIfCatalogCustodyAborted(signal);
		const database = await this.#port.database();
		throwIfCatalogCustodyAborted(signal);
		if (!database) throw new Error('Catalog original custody requires durable IndexedDB storage.');
		return database;
	}

	async #run<Result>(operation: (signal: AbortSignal) => Promise<Result>, signal?: AbortSignal): Promise<Result> {
		const admission = new MediaAssetWriteAdmission(this.#lifecycle, signal);
		try {
			admission.throwIfCancelled();
			return await operation(admission.signal);
		} finally {
			// Root transactions settle or roll back before the admission releases;
			// there is no external payload cleanup for a scalar custody operation.
			admission.complete();
			admission.release();
		}
	}
}
