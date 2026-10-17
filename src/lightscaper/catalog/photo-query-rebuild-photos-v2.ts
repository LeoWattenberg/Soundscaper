/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { serializePhotoDocumentV1OrV2 } from './photo-document-v2.ts';
import { readStoredPhotoV1OrV2 } from './photo-catalog-records-v2.ts';
import { readStoredPhotoCurrentV1 } from './photo-catalog-records-current-v1.ts';
import { serializePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1 } from './photo-document-current-v1.ts';
import type { PhotoCatalogDocumentModeV2 } from './photo-catalog-writes-kernel-v2.ts';
import { readIndexState } from './repository-records.ts';
import { id } from './value-validation.ts';
import { PHOTO_QUERY_LIMITS_V1 } from './photo-query-types-v1.ts';
import { PHOTO_QUERY_LIMITS_V2 } from './photo-query-types-v2.ts';
import { photoQueryBuildProgressV1, projectPhotoQueryRowV1, publishPhotoQueryRowV1, readPhotoQueryBuildStateV1 } from './photo-query-index-v1.ts';
import { projectPhotoQueryRowV2 } from './photo-query-index-v2.ts';
import { photoQueryBuildProgressV2, publishPhotoQueryRowV2, readPhotoQueryBuildStateV2 } from './photo-query-index-storage-v2.ts';

/** Existing row profiles stay unchanged; this fixed owner admits Photo1/2. */
export function rebuildPhotoQueryIndexPageForPhotosV2(database: IDBDatabase, catalogId: string, profile: 1, signal?: AbortSignal): ReturnType<typeof rebuildLegacy>;
export function rebuildPhotoQueryIndexPageForPhotosV2(database: IDBDatabase, catalogId: string, profile: 2, signal?: AbortSignal): ReturnType<typeof rebuildCurrent>;
export function rebuildPhotoQueryIndexPageForPhotosV2(database: IDBDatabase, catalogId: string, profile: 1 | 2, signal?: AbortSignal) {
	return rebuild(database, catalogId, profile, 'legacy2', signal);
}
/** Explicit current full-document authority; projected wire schemas are stable. */
export function rebuildPhotoQueryIndexPageForPhotosCurrentV1(database: IDBDatabase, catalogId: string, profile: 1, signal?: AbortSignal): ReturnType<typeof rebuildLegacy>;
export function rebuildPhotoQueryIndexPageForPhotosCurrentV1(database: IDBDatabase, catalogId: string, profile: 2, signal?: AbortSignal): ReturnType<typeof rebuildCurrent>;
export function rebuildPhotoQueryIndexPageForPhotosCurrentV1(database: IDBDatabase, catalogId: string, profile: 1 | 2, signal?: AbortSignal) {
	return rebuild(database, catalogId, profile, 'current3', signal);
}
function rebuild(database: IDBDatabase, catalogId: string, profile: 1 | 2, mode: PhotoCatalogDocumentModeV2, signal?: AbortSignal) {
	if (profile !== 1 && profile !== 2) throw new RangeError('Unsupported current photo query profile.');
	return profile === 1 ? rebuildLegacy(database, catalogId, mode, signal) : rebuildCurrent(database, catalogId, mode, signal);
}

async function rebuildLegacy(database: IDBDatabase, catalogId: string, mode: PhotoCatalogDocumentModeV2, signal?: AbortSignal) {
	const catalog = id(catalogId, 'query rebuild catalog');
	return catalogTransaction(database, ['catalogs', 'catalogStates', 'photos', 'photoQueryRows', 'photoQueryBuildStates'], 'readwrite', async (stores) => {
		const stateValue: unknown = await request(stores.catalogStates.get(catalog));
		if (stateValue === undefined) throw new ReferenceError('Photo catalog is missing.');
		const state = readIndexState(stateValue);
		const root = validateLightscaperDocumentV1(await request(stores.catalogs.get(catalog)) as unknown);
		if (root.kind !== 'photo-catalog') throw new TypeError('Query rebuilding requires a catalog root.');
		if (root.id !== catalog || state.id !== catalog || root.revision !== state.rootRevision || root.photoCount !== state.photoCount) throw new TypeError('Query rebuild catalog state disagrees.');
		const rawBuild: unknown = await request(stores.photoQueryBuildStates.get(catalog));
		const build = rawBuild === undefined ? { id: catalog, schemaVersion: 1, ready: false, afterKey: null, indexedCount: 0 } : readPhotoQueryBuildStateV1(rawBuild, catalog);
		if (build.indexedCount > root.photoCount || (build.ready && build.indexedCount !== root.photoCount)) throw new TypeError('Query build count disagrees with its catalog.');
		if (build.ready) return photoQueryBuildProgressV1(0, 0, true);
		const range = IDBKeyRange.bound(build.afterKey ?? `${catalog}|`, `${catalog}|\uffff`, build.afterKey !== null, true);
		let processed = 0; let bytes = 0; let afterKey = build.afterKey;
		const ready = await new Promise<boolean>((resolve, reject) => {
			const cursor = stores.photos.openCursor(range);
			cursor.onerror = () => reject(cursor.error ?? new Error('Could not rebuild the photo query index.'));
			cursor.onsuccess = () => {
				try {
					assertNotAborted(signal);
					const current = cursor.result;
					if (!current) { resolve(true); return; }
					const { row, length } = prepareRebuildRow(current.value as unknown, catalog, current.primaryKey, mode);
					if (bytes + length > PHOTO_QUERY_LIMITS_V1.rebuildBytes) { resolve(false); return; }
					void publishPhotoQueryRowV1(stores, row).then(() => {
						processed++; bytes += length; afterKey = row.key;
						if (processed === PHOTO_QUERY_LIMITS_V1.rebuildPhotos) resolve(false);
						else current.continue();
					}).catch(reject);
				} catch (error) { reject(error); }
			};
		});
		const latestRaw: unknown = await request(stores.photoQueryBuildStates.get(catalog));
		const latest = latestRaw === undefined ? build : readPhotoQueryBuildStateV1(latestRaw, catalog);
		if (ready && latest.indexedCount !== root.photoCount) throw new TypeError('Photo query index count disagrees with the catalog; rebuilding cannot claim readiness.');
		await request(stores.photoQueryBuildStates.put({ ...latest, ready, afterKey }));
		return photoQueryBuildProgressV1(processed, bytes, ready);
	}, signal);
}

/** Normalized source validation ends before the asynchronous write closure owns the derived row. */
function prepareRebuildRow(value: unknown, catalog: string, primaryKey: IDBValidKey, mode: PhotoCatalogDocumentModeV2) {
	const photo = mode === 'legacy2' ? readStoredPhotoV1OrV2(value) : readStoredPhotoCurrentV1(value);
	if (photo.catalogId !== catalog || primaryKey !== `${catalog}|${photo.id}`) throw new TypeError('Query rebuild source belongs to another catalog.');
	const row = projectPhotoQueryRowV1(photo);
	const length = new TextEncoder().encode(serialize(photo, mode)).byteLength + new TextEncoder().encode(JSON.stringify(row)).byteLength;
	return { row, length };
}

async function rebuildCurrent(database: IDBDatabase, catalogId: string, mode: PhotoCatalogDocumentModeV2, signal?: AbortSignal) {
	const catalog = id(catalogId, 'query2 rebuild catalog');
	return catalogTransaction(database, ['catalogs', 'catalogStates', 'photos', 'photoQueryRowsV2', 'photoQueryBuildStatesV2'], 'readwrite', async stores => {
		const stateValue: unknown = await request(stores.catalogStates.get(catalog));
		if (stateValue === undefined) throw new ReferenceError('Photo catalog is missing.');
		const state = readIndexState(stateValue);
		const root = validateLightscaperDocumentV1(await request(stores.catalogs.get(catalog)) as unknown);
		if (root.kind !== 'photo-catalog' || root.id !== catalog || state.id !== catalog
			|| root.revision !== state.rootRevision || root.photoCount !== state.photoCount) throw new TypeError('Query2 rebuild catalog state disagrees.');
		const rawBuild: unknown = await request(stores.photoQueryBuildStatesV2.get(catalog));
		const build = readPhotoQueryBuildStateV2(rawBuild === undefined ? { id: catalog, schemaVersion: 2, ready: false, afterKey: null, indexedCount: 0 } : rawBuild, catalog);
		if (build.indexedCount > root.photoCount || (build.ready && build.indexedCount !== root.photoCount)) throw new TypeError('Query2 build count disagrees with its catalog.');
		if (build.ready) return photoQueryBuildProgressV2(0, 0, 0, true);
		const range = IDBKeyRange.bound(build.afterKey ?? `${catalog}|`, `${catalog}|\uffff`, build.afterKey !== null, true);
		let processed = 0, bytes = 0, derivedBytes = 0, afterKey = build.afterKey;
		const ready = await new Promise<boolean>((resolve, reject) => {
			const cursor = stores.photos.openCursor(range);
			cursor.onerror = () => reject(cursor.error ?? new Error('Could not rebuild the photo query2 index.'));
			cursor.onsuccess = () => {
				try {
					assertNotAborted(signal);
					const current = cursor.result;
					if (!current) { resolve(true); return; }
					const prepared = prepare(current.value as unknown, catalog, current.primaryKey, mode);
					if (bytes + derivedBytes + prepared.bytes + prepared.derivedBytes > PHOTO_QUERY_LIMITS_V2.rebuildBytes) { resolve(false); return; }
					void publishPhotoQueryRowV2(stores, prepared.row, 'rebuild').then(() => {
						assertNotAborted(signal);
						processed++; bytes += prepared.bytes; derivedBytes += prepared.derivedBytes; afterKey = prepared.row.key;
						if (processed === PHOTO_QUERY_LIMITS_V2.rebuildPhotos) resolve(false);
						else current.continue();
					}).catch(reject);
				} catch (error) { reject(error); }
			};
		});
		const latestRaw: unknown = await request(stores.photoQueryBuildStatesV2.get(catalog));
		const latest = latestRaw === undefined ? build : readPhotoQueryBuildStateV2(latestRaw, catalog);
		if (latest.indexedCount > root.photoCount || (ready && latest.indexedCount !== root.photoCount)) throw new TypeError('Query2 index count disagrees; rebuilding cannot claim readiness.');
		await request(stores.photoQueryBuildStatesV2.put(readPhotoQueryBuildStateV2({ ...latest, ready, afterKey }, catalog)));
		return photoQueryBuildProgressV2(processed, bytes, derivedBytes, ready);
	}, signal);
}

function prepare(value: unknown, catalog: string, primaryKey: IDBValidKey, mode: PhotoCatalogDocumentModeV2) {
	const photo = mode === 'legacy2' ? readStoredPhotoV1OrV2(value) : readStoredPhotoCurrentV1(value);
	if (photo.catalogId !== catalog || primaryKey !== `${catalog}|${photo.id}`) throw new TypeError('Query2 rebuild source belongs to another catalog.');
	const bytes = new TextEncoder().encode(serialize(photo, mode)).byteLength;
	const row = projectPhotoQueryRowV2(photo);
	return { row, bytes, derivedBytes: new TextEncoder().encode(JSON.stringify(row)).byteLength };
}

function serialize(photo: PhotoDocumentCurrentV1, mode: PhotoCatalogDocumentModeV2): string {
	return mode === 'legacy2' ? serializePhotoDocumentV1OrV2(photo) : serializePhotoDocumentCurrentV1(photo);
}
