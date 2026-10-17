/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';
import { readCursorPage, request, transact } from './indexeddb-backend.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE, MEDIA_ASSET_STREAM_CHUNK_BYTES } from './media-asset-chunk-schema.ts';
import type { PreparedMediaAssetStaging } from './media-asset-staged-sink.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from './media-asset-staging-schema.ts';
import { MediaPublicationReconciliationError } from './media-asset-owned-publication.ts';
import { trustedMediaContentSha256, verifiedMediaContentDigest } from './media-content-provenance.ts';
import { CATALOG_ORIGINAL_ASSET_INDEX_NAME, CATALOG_ORIGINAL_PAGE_SIZE, CATALOG_ORIGINAL_ROOT_STORE_NAME,
	catalogOriginalKey, normalizeCatalogOriginalRoot, type CatalogOriginalRootV1 } from './media-catalog-original-schema.ts';
import type { CatalogOriginalRepairBindingV1 } from './media-catalog-original-repair-contract.ts';
import type { StorageRecord } from './media-records.ts';

export interface CatalogOriginalRepairCaptureV1 {
	readonly root: Readonly<CatalogOriginalRootV1>;
	readonly record: StorageRecord | null;
}

const throwIfAborted = createAbortGuard('Catalog original repair was cancelled.');
const ROOT_STORES = ['mediaAssets', CATALOG_ORIGINAL_ROOT_STORE_NAME];
const PUBLICATION_STORES = [...ROOT_STORES, MEDIA_ASSET_STAGING_STORE_NAME];

/** Internal custody capture shared with read-only inspection; private fields never enter receipts. */
export function readCatalogOriginalRepairCapture(
	database: IDBDatabase, binding: CatalogOriginalRepairBindingV1, signal?: AbortSignal,
): Promise<Readonly<CatalogOriginalRepairCaptureV1>> {
	throwIfAborted(signal);
	return transact(database, ROOT_STORES, 'readonly', async stores => {
		const root = await readSelectedRoot(stores[CATALOG_ORIGINAL_ROOT_STORE_NAME], binding);
		await countMatchingRoots(stores[CATALOG_ORIGINAL_ROOT_STORE_NAME], root, signal);
		const record = await readRow(stores.mediaAssets, binding.assetId);
		if (record) assertRecordIdentity(record, root);
		throwIfAborted(signal);
		return Object.freeze({ root, record });
	});
}

/** A dedicated exact-body CAS; ordinary immutable publication is deliberately not reused. */
export async function publishCatalogOriginalRepair(
	database: IDBDatabase, binding: CatalogOriginalRepairBindingV1, captured: CatalogOriginalRepairCaptureV1,
	prepared: PreparedMediaAssetStaging, chunkCount: number, signal?: AbortSignal,
): Promise<void> {
	let candidate: StorageRecord | null = null;
	let mutationStarted = false;
	let abort: (() => void) | undefined;
	try {
		await transact(database, PUBLICATION_STORES, 'readwrite', async (stores, transaction) => {
			abort = () => { try { transaction.abort(); } catch { /* A committed write wins late cancellation. */ } };
			signal?.addEventListener('abort', abort, { once: true });
			throwIfAborted(signal);
			const root = await readSelectedRoot(stores[CATALOG_ORIGINAL_ROOT_STORE_NAME], binding);
			if (JSON.stringify(root) !== JSON.stringify(captured.root)) throw new Error('Selected catalog original root identity changed.');
			const count = await countMatchingRoots(stores[CATALOG_ORIGINAL_ROOT_STORE_NAME], root, signal);
			const current = await readRow(stores.mediaAssets, binding.assetId);
			if (!sameCapturedRow(current, captured.record)) throw new Error('Original media locator or identity changed before repair.');
			if (current) assertRecordIdentity(current, root);
			await prepared.lease.assertInStore(stores[MEDIA_ASSET_STAGING_STORE_NAME]);
			throwIfAborted(signal);
			candidate = repairedRecord(current, root, binding, prepared, chunkCount, count);
			mutationStarted = true;
			await request(stores.mediaAssets.put(candidate));
			await prepared.lease.completeInStore(stores[MEDIA_ASSET_STAGING_STORE_NAME]);
			throwIfAborted(signal);
		});
	} catch (primary) {
		if (!mutationStarted || !candidate) throw primary;
		let outcome: Readonly<{ current: StorageRecord | null; rollback: boolean }>;
		try { outcome = await transact(database, ['mediaAssets', MEDIA_ASSET_STAGING_STORE_NAME], 'readonly', async stores => {
			const current = await readRow(stores.mediaAssets, binding.assetId);
			if (sameCapturedRow(current, candidate)) return { current, rollback: false };
			if (!sameCapturedRow(current, captured.record)) return { current, rollback: false };
			// A live original lease proves our publication rolled back. A consumed
			// or invalidated lease cannot authorize disposal of possibly read bytes.
			await prepared.lease.assertInStore(stores[MEDIA_ASSET_STAGING_STORE_NAME]);
			return { current, rollback: true };
		}); }
		catch (reconciliation) { throw new MediaPublicationReconciliationError(primary, reconciliation); }
		if (sameCapturedRow(outcome.current, candidate)) return;
		if (!outcome.rollback) throw new MediaPublicationReconciliationError(primary,
			new Error('Repair publication may have committed and been superseded. Its payload remains protected.'));
		throw primary;
	} finally { if (abort) signal?.removeEventListener('abort', abort); }
}

async function readSelectedRoot(store: IDBObjectStore, binding: CatalogOriginalRepairBindingV1): Promise<Readonly<CatalogOriginalRootV1>> {
	const value: unknown = await request(store.get(catalogOriginalKey(binding.catalogId, binding.importId, binding.photoId)));
	if (value === undefined) throw new Error('The selected catalog original root is missing.');
	const root = normalizeCatalogOriginalRoot(value);
	if (root.catalogId !== binding.catalogId || root.importId !== binding.importId || root.photoId !== binding.photoId
		|| root.assetId !== binding.assetId || root.sourceId !== binding.sourceId || root.sha256 !== binding.sha256 || root.size !== binding.size) {
		throw new Error('Selected catalog original root identity disagrees with the repair binding.');
	}
	return root;
}

async function countMatchingRoots(store: IDBObjectStore, expected: CatalogOriginalRootV1, signal?: AbortSignal): Promise<number> {
	const index = store.index(CATALOG_ORIGINAL_ASSET_INDEX_NAME);
	let afterPrimaryKey: IDBValidKey | undefined, count = 0;
	while (true) {
		throwIfAborted(signal);
		const page = await readCursorPage(index, { query: expected.assetId, afterPrimaryKey, limit: CATALOG_ORIGINAL_PAGE_SIZE,
			project: (value, primaryKey) => {
				const root = normalizeCatalogOriginalRoot(value);
				if (root.key !== primaryKey || root.assetId !== expected.assetId || root.mediaContentToken !== expected.mediaContentToken
					|| root.sha256 !== expected.sha256 || root.size !== expected.size) throw new Error('Retained catalog original root identity is inconsistent.');
				return primaryKey;
			} });
		count += page.length;
		if (!Number.isSafeInteger(count)) throw new RangeError('Original root count exceeds its safe integer bound.');
		if (page.length < CATALOG_ORIGINAL_PAGE_SIZE) return count;
		afterPrimaryKey = page.at(-1);
	}
}

async function readRow(store: IDBObjectStore, assetId: string): Promise<StorageRecord | null> {
	const value: unknown = await request(store.get(assetId));
	if (value === undefined) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Original media metadata is corrupt.');
	return value as StorageRecord;
}

function assertRecordIdentity(record: StorageRecord, root: CatalogOriginalRootV1): void {
	if (record.sourceId !== root.assetId || trustedMediaContentSha256(record) !== root.sha256
		|| record.mediaContentToken !== root.mediaContentToken || record.size !== root.size) throw new Error('Retained original media identity changed.');
	if (!['indexeddb-blob', MEDIA_ASSET_CHUNK_STORAGE_TYPE, 'opfs'].includes(String(record.storage))) throw new TypeError('Unsupported original storage layout.');
}

function sameCapturedRow(current: StorageRecord | null, expected: StorageRecord | null): boolean {
	if (!current || !expected) return current === expected;
	// Inline bodies live at the immutable row key. Every repair moves them to a
	// fresh path/token, so concurrent legitimate repairs change this descriptor.
	return ['sourceId', 'storage', 'sha256', 'size', 'mediaContentDigestVersion', 'mediaContentToken',
		'path', 'mediaChunkToken', 'mediaChunkBytes', 'mediaChunkCount'].every(key => Object.is(current[key], expected[key]));
}

function repairedRecord(current: StorageRecord | null, root: CatalogOriginalRootV1, binding: CatalogOriginalRepairBindingV1,
	prepared: PreparedMediaAssetStaging, chunkCount: number, count: number): StorageRecord {
	const result: Record<string, unknown> = current ? { ...current } : { name: binding.name, mimeType: binding.mimeType, committedAt: new Date().toISOString() };
	for (const key of ['storage', 'path', 'blob', 'mediaChunkToken', 'mediaChunkBytes', 'mediaChunkCount']) delete result[key];
	Object.assign(result, { sourceId: binding.assetId, ...verifiedMediaContentDigest(root.sha256, root.mediaContentToken),
		storage: prepared.sink.storage, size: root.size, catalogRootCount: count });
	if (prepared.sink.path) result.path = prepared.sink.path;
	if (prepared.sink.mediaChunkToken) Object.assign(result, { mediaChunkToken: prepared.sink.mediaChunkToken,
		mediaChunkBytes: MEDIA_ASSET_STREAM_CHUNK_BYTES, mediaChunkCount: chunkCount });
	return result;
}
