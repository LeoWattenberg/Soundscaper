/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from './types.ts';
import { boolean, field, id, integer, oneOf, record } from './value-validation.ts';
import type { PhotoQueryRowV2 } from './photo-query-index-v2.ts';
import { PHOTO_QUERY_LIMITS_V2 } from './photo-query-types-v2.ts';

export interface PhotoQueryBuildStateV2 {
	readonly id: string;
	readonly schemaVersion: 2;
	readonly ready: boolean;
	readonly afterKey: string | null;
	readonly indexedCount: number;
}

export function readPhotoQueryBuildStateV2(value: unknown, catalogId: string): PhotoQueryBuildStateV2 {
	const catalog = id(catalogId, 'query2 build catalog');
	const input = record(value, 'photo query2 build state', ['id', 'schemaVersion', 'ready', 'afterKey', 'indexedCount']);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported or future photo query2 build version.');
	if (id(field(input, 'id'), 'query2 build catalog') !== catalog) throw new TypeError('Query2 build belongs to another catalog.');
	const afterKey = field(input, 'afterKey');
	if (afterKey !== null) {
		if (typeof afterKey !== 'string' || !afterKey.startsWith(`${catalog}|`)) throw new TypeError('Query2 build cursor belongs to another catalog.');
		id(afterKey.slice(catalog.length + 1), 'query2 build photo');
	}
	return Object.freeze({ id: catalog, schemaVersion: 2, ready: boolean(field(input, 'ready'), 'query2 build readiness'),
		afterKey, indexedCount: integer(field(input, 'indexedCount'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos, 'query2 indexed count') });
}

/** Admitted project/readRowV2 output; do not clone another full row inside the caller's transaction. */
export async function publishPhotoQueryRowV2(stores: Readonly<Record<string, IDBObjectStore>>, value: PhotoQueryRowV2, mode: 'insert' | 'replace' | 'rebuild'): Promise<void> {
	const row = value, admittedMode = oneOf(mode, ['insert', 'replace', 'rebuild'] as const, 'query2 publication mode');
	const rawBuild: unknown = await request(stores.photoQueryBuildStatesV2.get(row.catalogId));
	const build = rawBuild === undefined ? readPhotoQueryBuildStateV2({ id: row.catalogId, schemaVersion: 2, ready: false, afterKey: null, indexedCount: 0 }, row.catalogId)
		: readPhotoQueryBuildStateV2(rawBuild, row.catalogId);
	const previous: unknown = await request(stores.photoQueryRowsV2.getKey(row.key));
	if (rawBuild === undefined && previous === undefined) {
		if (await request(stores.photoQueryRowsV2.index('catalogId').getKey(row.catalogId)) !== undefined) throw new TypeError('Existing query2 rows require a consistent build state.');
	}
	if (previous !== undefined && (rawBuild === undefined || build.indexedCount === 0)) throw new TypeError('Existing query2 rows require a consistent build state.');
	if (previous !== undefined && admittedMode === 'insert') throw new TypeError('Cannot insert an existing photo query2 row.');
	if (previous === undefined && admittedMode === 'replace' && build.ready) throw new TypeError('Ready query2 replacement row is missing.');
	const next = previous === undefined ? readPhotoQueryBuildStateV2({ ...build, indexedCount: build.indexedCount + 1 }, row.catalogId) : build;
	await request(stores.photoQueryRowsV2.put(row));
	if (previous === undefined) await request(stores.photoQueryBuildStatesV2.put(next));
}

export interface PhotoQueryBuildProgressV2 { readonly processed: number; readonly bytes: number; readonly derivedBytes: number; readonly ready: boolean }
export function photoQueryBuildProgressV2(processed: number, bytes: number, derivedBytes: number, ready: boolean): PhotoQueryBuildProgressV2 {
	const source = integer(bytes, 0, PHOTO_QUERY_LIMITS_V2.rebuildBytes, 'query2 rebuilt source bytes');
	const derived = integer(derivedBytes, 0, PHOTO_QUERY_LIMITS_V2.rebuildBytes, 'query2 rebuilt derived bytes');
	if (source + derived > PHOTO_QUERY_LIMITS_V2.rebuildBytes) throw new RangeError('Photo query2 rebuild exceeds its combined byte budget.');
	return Object.freeze({ processed: integer(processed, 0, PHOTO_QUERY_LIMITS_V2.rebuildPhotos, 'query2 rebuilt photos'),
		bytes: source, derivedBytes: derived, ready: boolean(ready, 'query2 rebuilt readiness') });
}
