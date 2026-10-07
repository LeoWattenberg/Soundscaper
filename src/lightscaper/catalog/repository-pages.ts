/* SPDX-License-Identifier: AGPL-3.0-only */

import { readCursorPage, request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { filterScope, readIndexState, readPhotoSummary, photoStorageKey } from './repository-records.ts';
import {
	PHOTO_CATALOG_REPOSITORY_LIMITS as LIMITS,
	PhotoCatalogRevisionConflictError,
	type PhotoCatalogContinuationV1,
	type PhotoCatalogFilterV1,
	type PhotoSummaryPageV1,
} from './repository-types.ts';
import { field, id, integer, record } from './value-validation.ts';

export interface PhotoSummaryPageRequestV1 {
	readonly filter?: PhotoCatalogFilterV1;
	readonly continuation?: PhotoCatalogContinuationV1 | null;
	readonly signal?: AbortSignal;
}

export async function readCatalogSummaryPageV1(database: IDBDatabase, catalogId: string, options: PhotoSummaryPageRequestV1 = {}): Promise<PhotoSummaryPageV1> {
	const catalog = id(catalogId, 'catalog ID');
	const scope = filterScope(catalog, options.filter);
	const continuation = options.continuation ? readContinuation(options.continuation, catalog, scope) : null;
	return catalogTransaction(database, ['catalogStates', 'summaries', 'memberships'], 'readonly', async (stores) => {
		const rawState: unknown = await request(stores.catalogStates.get(catalog));
		if (rawState === undefined) throw new ReferenceError('Photo catalog is missing.');
		const state = readIndexState(rawState);
		if (state.id !== catalog) throw new TypeError('Catalog index state belongs to another catalog.');
		if (continuation && continuation.indexRevision !== state.indexRevision) throw new PhotoCatalogRevisionConflictError('catalog');
		const all = options.filter === undefined;
		const page = await readCursorPage(stores[all ? 'summaries' : 'memberships'].index(all ? 'catalogId' : 'scope'), {
			query: all ? catalog : scope,
			afterPrimaryKey: continuation?.afterKey,
			limit: LIMITS.pageSize,
			project: (value, primaryKey) => {
				if (typeof primaryKey !== 'string') throw new TypeError('Catalog cursor requires a string primary key.');
				if (all) return Object.freeze({ cursorKey: primaryKey, summary: readPhotoSummary(value), photoKey: null });
				const membership = record(value, 'catalog membership', ['key', 'scope', 'photoKey']);
				if (field(membership, 'key') !== primaryKey || field(membership, 'scope') !== scope) throw new TypeError('Catalog membership cursor disagrees with its scope.');
				const photoKey = field(membership, 'photoKey');
				if (typeof photoKey !== 'string' || !photoKey.startsWith(`${catalog}|`)) throw new TypeError('Catalog membership references an invalid photo key.');
				const photoId = photoKey.slice(catalog.length + 1);
				if (photoStorageKey(catalog, photoId) !== photoKey || primaryKey !== `${scope}|${photoId}`) throw new TypeError('Catalog membership identity is invalid.');
				return Object.freeze({ cursorKey: primaryKey, summary: null, photoKey });
			},
		});
		const items = await Promise.all(page.map(async (entry) => {
			const summary = entry.summary ?? readPhotoSummary(await request(stores.summaries.get(entry.photoKey!)) as unknown);
			if (summary.catalogId !== catalog) throw new TypeError('Summary belongs to another catalog.');
			return summary;
		}));
		const last = page.at(-1);
		return Object.freeze({
			items: Object.freeze(items),
			continuation: last && page.length === LIMITS.pageSize ? Object.freeze({ catalogId: catalog, indexRevision: state.indexRevision, scope, afterKey: last.cursorKey }) : null,
		});
	}, options.signal);
}

function readContinuation(value: unknown, catalogId: string, scope: string): PhotoCatalogContinuationV1 {
	const input = record(value, 'catalog continuation', ['catalogId', 'indexRevision', 'scope', 'afterKey']);
	const prefix = scope === `${catalogId}|all` ? `${catalogId}|` : `${scope}|`;
	const after = field(input, 'afterKey');
	if (field(input, 'catalogId') !== catalogId || field(input, 'scope') !== scope
		|| typeof after !== 'string' || !after.startsWith(prefix)) throw new TypeError('Catalog continuation belongs to another catalog or query scope.');
	id(after.slice(prefix.length), 'continuation photo ID');
	return Object.freeze({ catalogId, scope, afterKey: after,
		indexRevision: integer(field(input, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'continuation index revision') });
}
