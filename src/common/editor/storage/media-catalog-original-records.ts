/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';
import { readCursorPage, request, transact } from './indexeddb-backend.ts';
import { trustedMediaContentSha256 } from './media-content-provenance.ts';
import type { StorageRecord } from './media-records.ts';
import {
	CATALOG_ORIGINAL_ASSET_INDEX_NAME, CATALOG_ORIGINAL_COUNT_FIELD,
	CATALOG_ORIGINAL_ROOT_STORE_NAME, catalogOriginalKey, catalogOriginalScope,
	normalizeCatalogOriginalRoot,
	type CatalogOriginalReferenceV1, type CatalogOriginalRootV1,
} from './media-catalog-original-schema.ts';

export const throwIfCatalogCustodyAborted = createAbortGuard('Catalog original custody was cancelled.');

export async function hasCatalogOriginalRoot(store: IDBObjectStore, assetId: string): Promise<boolean> {
	return (await readCursorPage(store.index(CATALOG_ORIGINAL_ASSET_INDEX_NAME), { query: assetId, limit: 1 })).length > 0;
}

export async function assertNoCatalogOriginalRoot(store: IDBObjectStore, assetId?: string): Promise<void> {
	const retained = assetId === undefined
		? (await readCursorPage(store, { limit: 1 })).length > 0
		: await hasCatalogOriginalRoot(store, assetId);
	if (retained) throw new Error(`Media ${assetId ?? 'storage'} is retained by a catalog original root.`);
}

export function catalogOriginalCount(record: StorageRecord): number {
	const count = record[CATALOG_ORIGINAL_COUNT_FIELD];
	return Number.isSafeInteger(count) && Number(count) > 0 ? Number(count) : 0;
}

export async function makeCatalogOriginalRoot(
	mediaAssets: IDBObjectStore, catalogId: string, importId: string | null, reference: CatalogOriginalReferenceV1,
): Promise<Readonly<CatalogOriginalRootV1>> {
	const media = await readMediaAsset(mediaAssets, reference.assetId);
	if (!media || !trustedMediaContentSha256(media)) throw new Error('A catalog original requires verified durable media.');
	if (media.sourceId !== reference.assetId || media.size !== reference.size || media.sha256 !== reference.sha256) {
		throw new Error('Catalog original media identity does not match its verified asset.');
	}
	return normalizeCatalogOriginalRoot({
		...reference, schemaVersion: 1, key: catalogOriginalKey(catalogId, importId, reference.photoId),
		catalogId, importId, scope: catalogOriginalScope(catalogId, importId), mediaContentToken: media.mediaContentToken,
	});
}

export async function putCatalogOriginalRoot(stores: Readonly<Record<string, IDBObjectStore>>, root: CatalogOriginalRootV1): Promise<void> {
	const roots = stores[CATALOG_ORIGINAL_ROOT_STORE_NAME];
	const previous = await request(roots.get(root.key)) as unknown;
	if (previous !== undefined) {
		if (JSON.stringify(normalizeCatalogOriginalRoot(previous)) !== JSON.stringify(root)) {
			throw new Error('A catalog original root is immutable.');
		}
		return;
	}
	await request(roots.put(root));
	await changeCount(stores.mediaAssets, root, 1);
}

export async function deleteCatalogOriginalRoot(stores: Readonly<Record<string, IDBObjectStore>>, key: string): Promise<void> {
	const roots = stores[CATALOG_ORIGINAL_ROOT_STORE_NAME];
	const value = await request(roots.get(key)) as unknown;
	if (value === undefined) return;
	const root = normalizeCatalogOriginalRoot(value);
	await request(roots.delete(key));
	await changeCount(stores.mediaAssets, root, -1);
}

export async function catalogCustodyTransaction<Result>(
	database: IDBDatabase, operation: (stores: Readonly<Record<string, IDBObjectStore>>) => Promise<Result>, signal?: AbortSignal,
): Promise<Result> {
	throwIfCatalogCustodyAborted(signal);
	let abort: (() => void) | undefined;
	try {
		return await transact(database, ['mediaAssets', CATALOG_ORIGINAL_ROOT_STORE_NAME], 'readwrite', async (stores, transaction) => {
			abort = (): void => { try { transaction.abort(); } catch { /* Commit already settled. */ } };
			signal?.addEventListener('abort', abort, { once: true });
			throwIfCatalogCustodyAborted(signal);
			return await operation(stores);
		});
	} finally { if (abort) signal?.removeEventListener('abort', abort); }
}

async function readMediaAsset(store: IDBObjectStore, key: string): Promise<StorageRecord | null> {
	const value: unknown = await request(store.get(key));
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

async function changeCount(store: IDBObjectStore, root: CatalogOriginalRootV1, delta: number): Promise<void> {
	const media = await readMediaAsset(store, root.assetId);
	if (!media || media.mediaContentToken !== root.mediaContentToken
		|| trustedMediaContentSha256(media) !== root.sha256 || media.size !== root.size) {
		throw new Error('Retained catalog original media identity changed.');
	}
	const previous = media[CATALOG_ORIGINAL_COUNT_FIELD] ?? 0;
	if (!Number.isSafeInteger(previous) || Number(previous) < 0) throw new Error('Catalog retention count is corrupt.');
	const next = Math.max(0, Number(previous) + delta);
	if (!Number.isSafeInteger(next)) throw new Error('Catalog retention count exceeds its safe integer budget.');
	await request(store.put({ ...media, [CATALOG_ORIGINAL_COUNT_FIELD]: next }));
}
