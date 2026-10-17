/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { serializeLightscaperDocumentV1, validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState, readStoredPhoto } from './repository-records.ts';
import { id } from './value-validation.ts';
import { PHOTO_QUERY_LIMITS_V1 } from './photo-query-types-v1.ts';
import { photoQueryBuildProgressV1, projectPhotoQueryRowV1, publishPhotoQueryRowV1, readPhotoQueryBuildStateV1 } from './photo-query-index-v1.ts';

export async function rebuildPhotoQueryIndexPageV1(database: IDBDatabase, catalogId: string, signal?: AbortSignal) {
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
					const { row, length } = prepareRebuildRow(current.value as unknown, catalog, current.primaryKey);
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
function prepareRebuildRow(value: unknown, catalog: string, primaryKey: IDBValidKey) {
	const photo = readStoredPhoto(value);
	if (photo.catalogId !== catalog || primaryKey !== `${catalog}|${photo.id}`) throw new TypeError('Query rebuild source belongs to another catalog.');
	const length = new TextEncoder().encode(serializeLightscaperDocumentV1(photo)).byteLength;
	return { row: projectPhotoQueryRowV1(photo), length };
}
