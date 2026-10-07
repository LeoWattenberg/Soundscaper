/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState } from './repository-records.ts';
import { PhotoCatalogRevisionConflictError } from './repository-types.ts';
import { field, id, record } from './value-validation.ts';
import { matchesNormalizedPhotoQuerySubjectV1 } from './smart-query.ts';
import { photoQueryRowKeyV1, PhotoQueryIndexNotReadyError, readPhotoQueryBuildStateV1, readPhotoQueryRowV1, type PhotoQueryRowV1 } from './photo-query-index-v1.ts';
import { normalizePhotoCatalogQueryV1, PHOTO_QUERY_LIMITS_V1, photoQueryDigestV1, readPhotoQueryContinuationV1,
	type PhotoCatalogQueryV1, type PhotoQueryContinuationV1, type PhotoQueryPageRequestV1, type PhotoQueryPageV1 } from './photo-query-types-v1.ts';
import type { PhotoCatalogRootV1 } from './types.ts';

export async function readPhotoQueryPageV1(database: IDBDatabase, catalogId: string, options: PhotoQueryPageRequestV1 = {}): Promise<PhotoQueryPageV1> {
	const catalog = id(catalogId, 'query catalog');
	const input = record(options, 'photo query page request', ['query', 'continuation', 'signal'], []);
	const query = normalizePhotoCatalogQueryV1(Object.hasOwn(input, 'query') ? field(input, 'query') : undefined);
	const continuationValue = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : undefined;
	const continuation = continuationValue === undefined || continuationValue === null ? null : readPhotoQueryContinuationV1(continuationValue, catalog, query);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') as AbortSignal | undefined : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Photo queries require a native cancellation signal.');
	return catalogTransaction(database, ['catalogs', 'catalogStates', 'photoQueryRows', 'photoQueryBuildStates'], 'readonly', async (stores) => {
		const stateValue: unknown = await request(stores.catalogStates.get(catalog));
		if (stateValue === undefined) throw new ReferenceError('Photo catalog is missing.');
		const state = readIndexState(stateValue);
		const root = validateLightscaperDocumentV1(await request(stores.catalogs.get(catalog)) as unknown);
		if (root.kind !== 'photo-catalog') throw new TypeError('Photo queries require a catalog root.');
		if (state.id !== catalog || root.id !== catalog || state.rootRevision !== root.revision || state.photoCount !== root.photoCount) throw new TypeError('Query catalog state disagrees with its root.');
		if (continuation && continuation.indexRevision !== state.indexRevision) throw new PhotoCatalogRevisionConflictError('catalog');
		const build: unknown = await request(stores.photoQueryBuildStates.get(catalog));
		if (build === undefined || !readPhotoQueryBuildStateV1(build, catalog).ready) throw new PhotoQueryIndexNotReadyError();
		if (readPhotoQueryBuildStateV1(build, catalog).indexedCount !== root.photoCount) throw new TypeError('Ready photo query count disagrees with its catalog.');
		const matches = queryMatcher(root, query);
		const bucket = continuation?.captureBucket ?? 0;
		const prefix: IDBValidKey[] = query.sort.field === 'capture-time' ? [catalog, bucket] : [catalog];
		const maximum: IDBValidKey[] = [...prefix, []];
		const after = continuation?.afterKey ? [...continuation.afterKey] : null;
		const descending = query.sort.direction === 'descending';
		const range = descending ? IDBKeyRange.bound(prefix, after ?? maximum, false, true)
			: IDBKeyRange.bound(after ?? prefix, maximum, after !== null, true);
		return new Promise<PhotoQueryPageV1>((resolve, reject) => {
			const items: PhotoQueryPageV1['items'][number][] = [];
			let scanned = 0; let lastKey: readonly (string | number)[] | null = null;
			const cursor = stores.photoQueryRows.index(query.sort.field).openCursor(range, descending ? 'prev' : 'next');
			const finish = (exhausted: boolean): void => {
				const nextBucket = exhausted && query.sort.field === 'capture-time' && bucket === 0;
				const next: PhotoQueryContinuationV1 | null = !exhausted || nextBucket ? Object.freeze({ schemaVersion: 1, catalogId: catalog,
					indexRevision: state.indexRevision, querySha256: photoQueryDigestV1(query), captureBucket: nextBucket ? 1 : bucket,
					afterKey: nextBucket ? null : lastKey }) : null;
				resolve(Object.freeze({ items: Object.freeze(items), scanned, continuation: next }));
			};
			cursor.onerror = () => reject(cursor.error ?? new Error('Could not read photo query cursor.'));
			cursor.onsuccess = () => {
				try {
					assertNotAborted(signal);
					const current = cursor.result;
					if (!current) { finish(true); return; }
					const row = readPhotoQueryRowV1(current.value as unknown);
					const key = photoQueryRowKeyV1(row, query.sort.field);
					if (row.catalogId !== catalog || current.primaryKey !== row.key || JSON.stringify(current.key) !== JSON.stringify(key)) throw new TypeError('Photo query cursor identity or index projection disagrees.');
					scanned++; lastKey = Object.freeze(key);
					if (matches(row)) items.push(row.summary);
					if (scanned === PHOTO_QUERY_LIMITS_V1.candidates) finish(false);
					else current.continue();
				} catch (error) { reject(error); }
			};
		});
	}, signal);
}

function queryMatcher(root: PhotoCatalogRootV1, query: PhotoCatalogQueryV1): (row: PhotoQueryRowV1) => boolean {
	const filter = query.filter;
	const keywords = new Map(root.keywords.map((node) => [node.id, node.name]));
	const collection = filter?.kind === 'collection' ? root.collections.find((candidate) => candidate.id === filter.id) : null;
	if (filter?.kind === 'collection' && !collection || filter?.kind === 'keyword' && !keywords.has(filter.id)
		|| filter?.kind === 'folder' && !root.folders.some((node) => node.id === filter.id)) throw new ReferenceError('Photo query references a missing catalog definition.');
	return (row) => {
		const summary = row.summary;
		if (filter) {
			switch (filter.kind) {
				case 'rating': if (summary.rating !== filter.value) return false; break;
				case 'flag': if (summary.flag !== filter.value) return false; break;
				case 'label': if (summary.colorLabel !== filter.value) return false; break;
				case 'folder': if (summary.folderId !== filter.id) return false; break;
				case 'keyword': if (!row.keywordIds.includes(filter.id)) return false; break;
				case 'collection':
					if (collection!.kind === 'manual') { if (!row.collectionIds.includes(filter.id)) return false; }
					else if (!matchesNormalizedPhotoQuerySubjectV1({ ...summary, keywordIds: row.keywordIds }, collection!.query)) return false;
					break;
			}
		}
		return query.text === '' || [summary.fileName, row.title, row.caption, row.creator, row.location].some((value) => value.toLowerCase().includes(query.text))
			|| row.keywordIds.some((keyword) => keywords.get(keyword)?.toLowerCase().includes(query.text));
	};
}
