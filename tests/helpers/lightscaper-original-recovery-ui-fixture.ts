/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../src/common/editor/closed-domain-value.ts';
import { openDatabase, readCursorPage, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { catalogOriginalKey, catalogOriginalScope, normalizeCatalogOriginalRoot,
	type CatalogOriginalRootV1 } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import { MEDIA_ASSET_STAGING_KIND_INDEX_NAME } from '../../src/common/editor/storage/media-asset-staging-schema.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import type { PhotoCatalogRootV1, PhotoDocumentV1 } from '../../src/lightscaper/catalog/types.ts';
import { normalizePhotoImportIntentV1, photoImportIntentKeyV1, type PhotoImportIntentV1 } from '../../src/lightscaper/import/import-intent-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, PHOTO_LIBRARY_INITIALIZATION_LOCK_ID_V1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { PHOTO_MEDIA_NAMESPACES_V1, PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';

// Production UI owns all photo authoring. Faults touch only the two selected
// photos' shared media row/root records. One source <=1KiB, two full documents,
// one <=64-root page, one native read/lock gate and a <=256KiB report are retained.
interface Owners {
	readonly media: PhotoMediaStoreV1;
	readonly catalog: PhotoCatalogRepositoryV1;
	readonly database: IDBDatabase;
	readonly root: PhotoCatalogRootV1;
	readonly photos: readonly PhotoDocumentV1[];
	readonly assetId: string;
}
export interface OriginalRecoveryAuthorityV1 {
	readonly row: Readonly<{ sourceId: string; storage: string; sha256: string; size: number;
		mediaContentDigestVersion: number; mediaContentToken: string; catalogRootCount: number }> | null;
	readonly roots: readonly Readonly<CatalogOriginalRootV1>[];
	readonly intent: PhotoImportIntentV1 | null;
	readonly stagingLeases: number;
	readonly chunks: number;
}
export interface OriginalRecoveryObservationV1 {
	readonly root: PhotoCatalogRootV1;
	readonly photos: readonly PhotoDocumentV1[];
	readonly authority: OriginalRecoveryAuthorityV1;
	readonly bytes: readonly number[] | null;
	readonly actualSha256: string | null;
}

export async function observeOriginalRecoveryLibraryV1(photoIds: readonly string[]): Promise<OriginalRecoveryObservationV1> {
	return withOwners(photoIds, async owners => {
		const authority = await authorityFor(owners);
		const body = await owners.media.mediaRepository.loadAsset(owners.assetId);
		let bytes: readonly number[] | null = null, actualSha256: string | null = null;
		if (body !== null) {
			if (!(body instanceof Blob) || body.size > 1024) throw new RangeError('Recovery witness original exceeds1KiB.');
			const buffer = await body.arrayBuffer(); bytes = Array.from(new Uint8Array(buffer));
			actualSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), value => value.toString(16).padStart(2, '0')).join('');
		}
		const output = { root: owners.root, photos: owners.photos, authority, bytes, actualSha256 };
		if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 256 * 1024) throw new RangeError('Recovery witness report exceeds256KiB.');
		return output;
	});
}

/** Explicit fault injection; no catalog/photo aggregate or source identity is changed. */
export async function seedOriginalRecoveryFaultV1(photoIds: readonly string[], mode: 'corrupt-body' | 'provisional-missing-row') {
	return withOwners(photoIds, async owners => {
		const before = await authorityFor(owners);
		if (!before.row || before.roots.length !== 2 || before.intent !== null || before.row.catalogRootCount !== 2
			|| before.roots.some(root => root.importId !== null)) throw new Error('Fault seeding requires exactly two committed roots of one original.');
		if (mode === 'corrupt-body') {
			const original = await owners.media.mediaRepository.loadAsset(owners.assetId);
			if (!(original instanceof Blob) || original.size < 1 || original.size > 1024) throw new Error('Recovery source is unavailable or too large.');
			const wrong = new Uint8Array(await original.arrayBuffer()); wrong[wrong.length - 1] = (wrong[wrong.length - 1] ?? 0) ^ 1;
			await transact(owners.database, 'mediaAssets', 'readwrite', async stores => {
				const record = await requiredMediaRow(stores.mediaAssets, owners.assetId);
				const replacement: Record<string, unknown> = { ...record, storage: 'indexeddb-blob', blob: new Blob([wrong], { type: 'image/png' }) };
				for (const key of ['path', 'mediaChunkToken', 'mediaChunkBytes', 'mediaChunkCount']) delete replacement[key];
				await request(stores.mediaAssets.put(replacement));
			});
			return { assetId: owners.assetId, provisionalPhotoId: null, importId: null };
		}
		if (mode !== 'provisional-missing-row') throw new TypeError('Unknown original recovery fault.');
		const photoId = owners.photos[0]?.id;
		if (!photoId) throw new Error('Published fault target is missing.');
		const committed = before.roots.find(root => root.photoId === photoId);
		if (!committed) throw new Error('Selected committed root is missing.');
		const importId = 'native-recovery-published-import';
		const provisional = normalizeCatalogOriginalRoot({ ...committed, importId,
			key: catalogOriginalKey(owners.root.id, importId, photoId), scope: catalogOriginalScope(owners.root.id, importId) });
		const intent = normalizePhotoImportIntentV1({ schemaVersion: 1, kind: 'photo-import', catalogId: owners.root.id, importId }, owners.root.id);
		await transact(owners.database, ['mediaAssets', 'catalogOriginalRoots', 'settings'], 'readwrite', async stores => {
			await request(stores.catalogOriginalRoots.delete(committed.key));
			await request(stores.catalogOriginalRoots.put(provisional));
			await request(stores.settings.put({ key: photoImportIntentKeyV1(owners.root.id), value: intent }));
			await request(stores.mediaAssets.delete(owners.assetId));
		});
		return { assetId: owners.assetId, provisionalPhotoId: photoId, importId };
	});
}

async function withOwners<Result>(photoIds: readonly string[], run: (owners: Owners) => Promise<Result>): Promise<Result> {
	if (photoIds.length !== 2 || new Set(photoIds).size !== 2 || photoIds.some(id => typeof id !== 'string' || !id || id.length > 256)) {
		throw new RangeError('Recovery UI observation requires exactly two explicit photo IDs.');
	}
	const media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	let database: IDBDatabase | null = null;
	try {
		await media.ready();
		const pointer = readClosedDomainRecord(await media.settingsRepository.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1),
			'recovery witness library pointer', ['schemaVersion', 'kind', 'catalogId']);
		const catalogId = readClosedDomainField(pointer, 'catalogId', 'recovery witness pointer');
		if (typeof catalogId !== 'string') throw new TypeError('Recovery witness catalog identity is absent.');
		const root = await catalog.loadCatalog(catalogId);
		if (!root || root.photoCount !== 2) throw new Error('Recovery witness must remain a two-photo catalog.');
		const photos: PhotoDocumentV1[] = [];
		for (const photoId of photoIds) {
			const photo = await catalog.loadPhoto(root.id, photoId);
			if (!photo) throw new Error('Recovery witness published photo is missing.');
			photos.push(photo);
		}
		const assetId = photos[0]?.original.storageKey;
		if (!assetId || photos.some(photo => photo.original.storageKey !== assetId || photo.original.byteLength > 1024)) {
			throw new Error('Recovery witness requires one shared <=1KiB original.');
		}
		database = await openDatabase(indexedDB, PHOTO_MEDIA_NAMESPACES_V1.databaseName);
		return await run({ media, catalog, database, root, photos, assetId });
	} finally { database?.close(); await Promise.all([catalog.close(), media.close()]); }
}

async function authorityFor(owners: Owners): Promise<OriginalRecoveryAuthorityV1> {
	return transact(owners.database, ['mediaAssets', 'catalogOriginalRoots', 'settings', 'mediaAssetStaging', 'mediaAssetChunks'], 'readonly', async stores => {
		const raw: unknown = await request(stores.mediaAssets.get(owners.assetId));
		const roots = await readCursorPage(stores.catalogOriginalRoots.index('assetId'), { query: owners.assetId, limit: 64,
			project: (value, key) => { const root = normalizeCatalogOriginalRoot(value); if (root.key !== key) throw new Error('Root key mismatch'); return root; } });
		if (roots.length !== 2 || roots.some(root => root.catalogId !== owners.root.id || !owners.photos.some(photo => photo.id === root.photoId))) {
			throw new Error('Recovery witness roots escaped the two selected published photos.');
		}
		const stored: unknown = await request(stores.settings.get(photoImportIntentKeyV1(owners.root.id)));
		const intent = stored === undefined ? null : normalizePhotoImportIntentV1(readClosedDomainField(stored as Record<string, unknown>, 'value', 'recovery witness intent row'), owners.root.id);
		return { row: raw === undefined ? null : scalarMediaRow(raw), roots, intent,
			stagingLeases: await request(stores.mediaAssetStaging.index(MEDIA_ASSET_STAGING_KIND_INDEX_NAME).count('lease')),
			chunks: await request(stores.mediaAssetChunks.count()) };
	});
}
async function requiredMediaRow(store: IDBObjectStore, assetId: string): Promise<StorageRecord> {
	const row: unknown = await request(store.get(assetId)); scalarMediaRow(row); return row as StorageRecord;
}
function scalarMediaRow(value: unknown): NonNullable<OriginalRecoveryAuthorityV1['row']> {
	if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Recovery witness media row is malformed.');
	const row = value as Record<string, unknown>;
	const text = (key: string) => { const value = readClosedDomainField(row, key, 'recovery witness media row');
		if (typeof value !== 'string' || !value || value.length > 256) throw new TypeError('Recovery witness media scalar is malformed.'); return value; };
	const integer = (key: string) => { const value = readClosedDomainField(row, key, 'recovery witness media row');
		if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Recovery witness media count is malformed.'); return value; };
	return { sourceId: text('sourceId'), storage: text('storage'), sha256: text('sha256'), size: integer('size'),
		mediaContentDigestVersion: integer('mediaContentDigestVersion'), mediaContentToken: text('mediaContentToken'), catalogRootCount: integer('catalogRootCount') };
}

interface ReadHold { calls: number; entered: boolean; released: boolean; byteLength: number | null; release: () => void; restore: () => void }
let readHold: ReadHold | null = null;
export function holdNextOriginalRecoveryReadV1(): void {
	if (readHold && !readHold.released) throw new Error('A recovery read gate is already pending.');
	const native = Blob.prototype.arrayBuffer; let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const hold: ReadHold = { calls: 0, entered: false, released: false, byteLength: null, release,
		restore: () => { Blob.prototype.arrayBuffer = native; } };
	readHold = hold;
	Blob.prototype.arrayBuffer = async function () {
		const result = Reflect.apply(native, this, []) as Promise<ArrayBuffer>;
		if (++hold.calls !== 1) return result;
		const buffer = await result; hold.byteLength = buffer.byteLength; hold.entered = true; await gate; return buffer;
	};
}
export function originalRecoveryReadStateV1() {
	return readHold ? { calls: readHold.calls, entered: readHold.entered, released: readHold.released, byteLength: readHold.byteLength } : null;
}
export function releaseOriginalRecoveryReadV1(): void {
	if (!readHold) return;
	readHold.released = true; readHold.release(); readHold.restore();
}

interface RetryHold { publicationCompleted: boolean; entered: boolean; released: boolean; release: () => void; restore: () => void }
let retryHold: RetryHold | null = null;
/** Hold only normal initialization after the actual media publication commits. */
export function holdOriginalRecoveryRetryV1(assetId: string): void {
	if (retryHold && !retryHold.released) throw new Error('A recovery retry gate is already pending.');
	const put = IDBObjectStore.prototype.put, nativeRequest = LockManager.prototype.request; let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const hold: RetryHold = { publicationCompleted: false, entered: false, released: false, release,
		restore: () => { IDBObjectStore.prototype.put = put; LockManager.prototype.request = nativeRequest; } };
	retryHold = hold;
	IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
		const result = key === undefined ? put.call(this, value) : put.call(this, value, key);
		if (this.name === 'mediaAssets' && this.transaction.db.name === PHOTO_MEDIA_NAMESPACES_V1.databaseName
			&& this.transaction.mode === 'readwrite' && this.transaction.objectStoreNames.contains('catalogOriginalRoots')
			&& this.transaction.objectStoreNames.contains('mediaAssetStaging')
			&& value && typeof value === 'object' && (value as StorageRecord).sourceId === assetId) {
			this.transaction.addEventListener('complete', () => { hold.publicationCompleted = true; }, { once: true });
		}
		return result;
	};
	LockManager.prototype.request = function (this: LockManager, ...args: Parameters<LockManager['request']>) {
		if (hold.publicationCompleted && !hold.entered && args[0].endsWith(PHOTO_LIBRARY_INITIALIZATION_LOCK_ID_V1)) {
			hold.entered = true;
			return gate.then(() => Reflect.apply(nativeRequest, this, args) as Promise<unknown>);
		}
		return Reflect.apply(nativeRequest, this, args) as Promise<unknown>;
	} as typeof nativeRequest;
}
export function originalRecoveryRetryStateV1() {
	return retryHold ? { publicationCompleted: retryHold.publicationCompleted, entered: retryHold.entered, released: retryHold.released } : null;
}
export function releaseOriginalRecoveryRetryV1(): void {
	if (!retryHold) return;
	retryHold.released = true; retryHold.release(); retryHold.restore();
}
