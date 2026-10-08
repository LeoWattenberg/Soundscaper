/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { serializeLightscaperDocumentV1, validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState, readStoredPhoto } from './repository-records.ts';
import { id } from './value-validation.ts';
import { projectPhotoQueryRowV2 } from './photo-query-index-v2.ts';
import { PHOTO_QUERY_LIMITS_V2 } from './photo-query-types-v2.ts';
import { photoQueryBuildProgressV2, publishPhotoQueryRowV2, readPhotoQueryBuildStateV2 } from './photo-query-index-storage-v2.ts';

/** Cursor input and its one derived row share the combined8MiB step budget. No aggregate pages are retained. */
export async function rebuildPhotoQueryIndexPageV2(database: IDBDatabase, catalogId: string, signal?: AbortSignal) {
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
					const prepared = prepare(current.value as unknown, catalog, current.primaryKey);
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

function prepare(value: unknown, catalog: string, primaryKey: IDBValidKey) {
	const photo = readStoredPhoto(value);
	if (photo.catalogId !== catalog || primaryKey !== `${catalog}|${photo.id}`) throw new TypeError('Query2 rebuild source belongs to another catalog.');
	const bytes = new TextEncoder().encode(serializeLightscaperDocumentV1(photo)).byteLength;
	const row = projectPhotoQueryRowV2(photo);
	return { row, bytes, derivedBytes: new TextEncoder().encode(JSON.stringify(row)).byteLength };
}
