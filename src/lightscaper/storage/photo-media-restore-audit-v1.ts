/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { normalizeCatalogOriginalRoot } from '../../common/editor/storage/media-catalog-original-schema.ts';
import { makeCatalogOriginalRoot, putCatalogOriginalRoot, deleteCatalogOriginalRoot } from '../../common/editor/storage/media-catalog-original-records.ts';
import { catalogTransaction } from '../catalog/catalog-transaction.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';
import { assertMediaRestoreOwnerV1, assertMediaRestorePhotoRootV1, readMediaRestoreCatalogPageV1,
	verifyMediaRestoreAssetV1 } from './photo-media-restore-read-v1.ts';
import { checkMediaRestoreSignalV1 } from './photo-media-restore-signal-v1.ts';
import { assertPhotoMediaRestorePresetsV1, type PhotoMediaRestorePresetBindingV1 } from './photo-media-restore-presets-v1.ts';

export interface PhotoMediaRestoreCountsV1 {
	readonly photoCount: number; readonly originalCount: number; readonly originalByteLength: number;
}

/** Serial source/body verification: <=64 scalar keys/bindings and one native <=4MiB chunk.
 * Counts are controls, not substitutes for the canonical binding/body audit. No whole-heap claim. */
export async function finishPhotoMediaRestoreV1(media: IDBDatabase, catalog: IDBDatabase,
	allocation: PhotoLibraryRestoreAllocationV1, root: PhotoCatalogRootV1, expected: PhotoMediaRestoreCountsV1,
	signal: AbortSignal, presets: PhotoMediaRestorePresetBindingV1 | null = null): Promise<Readonly<PhotoMediaRestoreCountsV1>> {
	await catalogTransaction(media, ['settings'], 'readonly', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation);
		await assertPhotoMediaRestorePresetsV1(stores.settings!, root.id, presets);
	}, signal);
	let photoCount = 0, after: string | null = null;
	for (;;) {
		const page = await readMediaRestoreCatalogPageV1(catalog, allocation, root, after, signal);
		if (!page.length) break;
		for (const binding of page) {
			if (++photoCount > root.photoCount) throw new Error('Restore catalog contains excess originals.');
			await assertMediaRestorePhotoRootV1(media, allocation, binding, signal);
		}
		after = `${root.id}|${page[page.length - 1]!.photoId}`;
	}
	if (photoCount !== root.photoCount || photoCount !== expected.photoCount) throw new Error('Restore catalog original count differs.');
	await inventory(media, allocation, 'catalogOriginalRoots', photoCount, async key => {
		await catalogTransaction(media, ['settings', 'catalogOriginalRoots'], 'readonly', async stores => {
			await assertMediaRestoreOwnerV1(stores, allocation);
			const row = normalizeCatalogOriginalRoot(await request(stores.catalogOriginalRoots!.get(key)));
			if (row.key !== key || row.catalogId !== root.id || row.importId !== allocation.operationId) throw new Error('Restore custody contains a foreign root.');
		}, signal);
	}, signal);
	let originalCount = 0, originalByteLength = 0, chunks = 0;
	await inventory(media, allocation, 'mediaAssets', expected.originalCount, async key => {
		const descriptor = await verifyMediaRestoreAssetV1(media, allocation, key, signal);
		originalCount++; originalByteLength += descriptor.size; chunks += descriptor.chunkCount;
		if (!Number.isSafeInteger(originalByteLength) || !Number.isSafeInteger(chunks)) throw new RangeError('Restore original totals exceed safe integers.');
	}, signal);
	if (originalCount !== expected.originalCount || originalByteLength !== expected.originalByteLength) throw new Error('Restore asset inventory differs.');
	// Each canonical expected chunk was authenticated above. Exact key cardinality excludes extra/orphan chunks.
	await inventory(media, allocation, 'mediaAssetChunks', chunks, () => undefined, signal);
	await promote(media, allocation, photoCount, signal);
	// Recheck the source namespace after promotion; no transient delivery cache is publication authority.
	await readMediaRestoreCatalogPageV1(catalog, allocation, root, null, signal);
	// Scalar native count fence supplements the completed bounded canonical audit. Backend count cost is not claimed O(1).
	return catalogTransaction(media, ['settings', 'mediaAssets', 'mediaAssetChunks', 'catalogOriginalRoots'], 'readwrite', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation);
		await assertPhotoMediaRestorePresetsV1(stores.settings!, root.id, presets);
		for (const [name, count] of [['mediaAssets', originalCount], ['mediaAssetChunks', chunks], ['catalogOriginalRoots', photoCount]] as const) {
			if (await request(stores[name]!.count()) !== count) throw new Error('Restore inventory changed before completion.');
		}
		return Object.freeze({ photoCount, originalCount, originalByteLength });
	}, signal); // Completed native acknowledgement wins a later cancellation.
}

async function promote(database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1, total: number, signal: AbortSignal): Promise<void> {
	let after: string | null = null, count = 0;
	for (;;) {
		const prefix = `${JSON.stringify([allocation.catalogId, allocation.operationId]).slice(0, -1)},`;
		const keys = await catalogTransaction(database, ['catalogOriginalRoots'], 'readonly', stores => readKeys(stores.catalogOriginalRoots!, after, 16, total - count, prefix), signal);
		if (!keys.length) break;
		const provisional = keys;
		await catalogTransaction(database, ['settings', 'mediaAssets', 'catalogOriginalRoots'], 'readwrite', async stores => {
			await assertMediaRestoreOwnerV1(stores, allocation);
			for (const key of provisional) {
				const row = normalizeCatalogOriginalRoot(await request(stores.catalogOriginalRoots!.get(key)));
				if (row.catalogId !== allocation.catalogId || row.importId !== allocation.operationId) throw new Error('Restore provisional custody changed.');
				await putCatalogOriginalRoot(stores, await makeCatalogOriginalRoot(stores.mediaAssets!, allocation.catalogId, null, row));
				await deleteCatalogOriginalRoot(stores, key);
			}
		}, signal);
		count += provisional.length; after = keys[keys.length - 1]!;
		if (count === total) return;
	}
	if (count !== total) throw new Error('Restore custody promotion is incomplete.');
}
async function inventory(database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1, store: string, maximum: number, visit: (key: string) => Promise<void> | void,
	signal: AbortSignal): Promise<void> {
	let count = 0, after: string | null = null;
	for (;;) {
		const keys = await catalogTransaction(database, ['settings', store], 'readonly', async stores => {
			await assertMediaRestoreOwnerV1(stores, allocation); return readKeys(stores[store]!, after, 64, maximum - count);
		}, signal);
		if (!keys.length) break;
		for (const key of keys) { await visit(key); count++; checkMediaRestoreSignalV1(signal); }
		after = keys[keys.length - 1]!;
	}
	if (count !== maximum) throw new Error('Restore physical inventory count differs.');
}

function readKeys(store: IDBObjectStore, after: string | null, limit: number, remaining: number, prefix?: string): Promise<readonly string[]> {
	return new Promise((resolve, reject) => {
		const keys: string[] = [], range = prefix === undefined ? (after === null ? undefined : IDBKeyRange.lowerBound(after, true))
			: IDBKeyRange.bound(after ?? prefix, `${prefix}\uffff`, after !== null, true);
		const opening = store.openKeyCursor(range);
		opening.onerror = () => { reject(opening.error ?? new Error('Could not inventory restore media.')); };
		opening.onsuccess = () => {
			const row = opening.result; if (!row) { resolve(keys); return; }
			const key = row.primaryKey;
			if (typeof key !== 'string' || key.length > 1024 || !/^[\u0020-\u007e]+$/u.test(key)
				|| (after !== null && key <= after) || (keys.length && key <= keys[keys.length - 1]!)) { reject(new TypeError('Restore media requires bounded ordered ASCII keys.')); return; }
			if (keys.length >= remaining) { reject(new Error('Restore media contains excess physical rows.')); return; }
			keys.push(key); if (keys.length === limit) resolve(keys); else row.continue();
		};
	});
}
