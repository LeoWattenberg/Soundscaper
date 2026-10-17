/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryCullingNavigationContextV1, PhotoLibraryCullingNavigationRequestV1 } from '../../common/editor/photo-library-culling-navigation-port-v1.ts';
import type { PhotoLibraryPageV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { readCursorPage, request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { field, id, record } from './value-validation.ts';
import { photoStorageKey, photoSummary, readPhotoSummary } from './repository-records.ts';
import { readStoredPhotoV1OrV2 } from './photo-catalog-records-v2.ts';
import { readStoredPhotoCurrentV1 } from './photo-catalog-records-current-v1.ts';
import type { PhotoCatalogDocumentModeV2 } from './photo-catalog-writes-kernel-v2.ts';
import { PhotoCatalogRevisionConflictError, type PhotoSummaryV1 } from './repository-types.ts';
import { readPhotoQueryContextV2 } from './photo-query-pages-v2.ts';
import { readPhotoQueryPageInTransactionV1 } from './photo-query-pages-v1.ts';
import { readPhotoQueryPageInTransactionV2 } from './photo-query-page-kernel-v2.ts';
import { normalizePhotoCatalogQueryV1, photoQueryDigestV1, type PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';
import { normalizePhotoCatalogQueryV2, photoQueryDigestV2, type PhotoCatalogQueryV2 } from './photo-query-types-v2.ts';
import { photoQueryMatcherV1 } from './photo-query-matcher-v1.ts';
import { photoQueryMatcherV2 } from './photo-query-matcher-v2.ts';
import { photoQueryRowKeyV1, projectPhotoQueryRowV1, readPhotoQueryRowV1, readPhotoQueryBuildStateV1, PhotoQueryIndexNotReadyError } from './photo-query-index-v1.ts';
import { photoQueryRowKeyV2, projectPhotoQueryRowV2, readPhotoQueryRowV2, photoQuerySummaryV2 } from './photo-query-index-v2.ts';
import { readPhotoQueryBuildStateV2 } from './photo-query-index-storage-v2.ts';
import { readPhotoStackQueryInTransaction, type PhotoStackQueryDestinationStart, type PhotoStackQueryKernelProgress } from './photo-stack-query-kernel.ts';
import { issuePhotoStackQueryProgressV1 } from './photo-stack-query-progress-v1.ts';
import { issuePhotoStackQueryProgressV2 } from './photo-stack-query-progress-v2.ts';
import { assertPhotoStackQuerySignalV1, withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, readPhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';
import { photoSmartCollectionKeyV1 } from './photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionDefinitionV1, validatePhotoSmartCollectionReferencesV1 } from './photo-smart-collection-read-v1.ts';
import { issuePhotoSavedQueryProgressV1, photoSavedDefinitionDigestV1 } from './photo-smart-collection-query-progress-v1.ts';

/** No caller-owned cursor or inclusive switch crosses this admission boundary. */
export function admitPhotoCullingNavigationV1(contextValue: unknown, value: unknown) {
	const input = record(value, 'culling destination request', ['photoId', 'signal'], ['photoId']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const selected = record(contextValue, 'culling destination context', ['kind', 'query', 'collectionId', 'collapsed'], ['kind']);
	const kind = field(selected, 'kind'); let context: PhotoLibraryCullingNavigationContextV1;
	if (kind === 'plain') { record(contextValue, 'plain culling context', ['kind']); context = Object.freeze({ kind }); }
	else if (kind === 'query' || kind === 'saved') {
		record(contextValue, 'queried culling context', kind === 'query' ? ['kind', 'query', 'collapsed'] : ['kind', 'collectionId', 'collapsed']);
		const collapsed = field(selected, 'collapsed'); if (typeof collapsed !== 'boolean') throw new TypeError('Culling grouping mode must be explicit.');
		if (kind === 'saved') context = Object.freeze({ kind, collectionId: id(field(selected, 'collectionId'), 'culling saved collection ID'), collapsed });
		else {
			const queryValue = field(selected, 'query');
			const query = queryValue !== null && typeof queryValue === 'object' && Object.hasOwn(queryValue, 'schemaVersion')
				? normalizePhotoCatalogQueryV2(queryValue) : normalizePhotoCatalogQueryV1(queryValue);
			context = Object.freeze({ kind, query, collapsed });
		}
	} else throw new RangeError('Unknown culling destination context.');
	return Object.freeze({ context, photoId: id(field(input, 'photoId'), 'culling destination photo ID'), ...(signal === undefined ? {} : { signal }) });
}

type Admitted = ReturnType<typeof admitPhotoCullingNavigationV1>;
type Query = PhotoCatalogQueryV1 | PhotoCatalogQueryV2;
interface Proof { readonly root: number; readonly index: number; readonly saved?: Readonly<{ revision: number; state: number; digest: string }> }
interface Progress { proof: Proof | null; start: PhotoStackQueryDestinationStart | null; pending: PhotoStackQueryKernelProgress | null }
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Private bounded audit phases finish before one fresh projected page escapes. */
export function readPhotoCullingDestinationPageV1(database: IDBDatabase, catalogId: string, context: PhotoLibraryCullingNavigationContextV1,
	value: PhotoLibraryCullingNavigationRequestV1): Promise<Readonly<PhotoLibraryPageV1> | null> {
	return readDestination(database, catalogId, context, value, 'legacy2');
}
/** Current point audits admit the complete Photo before scalar projection. */
export function readPhotoCullingDestinationPageCurrentV1(database: IDBDatabase, catalogId: string, context: PhotoLibraryCullingNavigationContextV1,
	value: PhotoLibraryCullingNavigationRequestV1): Promise<Readonly<PhotoLibraryPageV1> | null> {
	return readDestination(database, catalogId, context, value, 'current3');
}
function readDestination(database: IDBDatabase, catalogId: string, context: PhotoLibraryCullingNavigationContextV1,
	value: PhotoLibraryCullingNavigationRequestV1, mode: PhotoCatalogDocumentModeV2): Promise<Readonly<PhotoLibraryPageV1> | null> {
	const catalog = id(catalogId, 'culling catalog ID'), admitted = admitPhotoCullingNavigationV1(context, value);
	return withPhotoStackQuerySignalV1(admitted.signal, async caller => {
		const signal = caller ?? new AbortController().signal;
		const progress: Progress = { proof: null, start: null, pending: null };
		while (true) {
			Reflect.apply(CHECK, signal, []);
			const result = await step(database, catalog, admitted, progress, signal, mode); Reflect.apply(CHECK, signal, []);
			if (result !== undefined) return result;
			await new Promise<void>(resolve => { setTimeout(resolve, 0); }); Reflect.apply(CHECK, signal, []);
		}
	});
}

async function step(database: IDBDatabase, catalog: string, input: Admitted, progress: Progress, signal: AbortSignal, mode: PhotoCatalogDocumentModeV2) {
	const selected = input.context, saved = selected.kind === 'saved', plain = selected.kind === 'plain';
	const metadata = saved || (!plain && 'schemaVersion' in selected.query);
	const rowStore = metadata ? 'photoQueryRowsV2' : 'photoQueryRows', buildStore = metadata ? 'photoQueryBuildStatesV2' : 'photoQueryBuildStates';
	const storesOwned = [...new Set(['catalogs', 'catalogStates', 'photos', 'summaries',
		...(plain ? [] : [rowStore, buildStore]), ...(saved ? PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1 : []),
		...(!plain && selected.collapsed ? ['photoStacks', 'photoStackStates', 'photoStackMemberships'] : [])])];
	return catalogTransaction(database, storesOwned, 'readonly', async stores => {
		const { root, state } = await readPhotoQueryContextV2(stores, catalog);
		let query: Query | null = selected.kind === 'query' ? selected.query : null, savedProof: Proof['saved'];
		if (saved) {
			const owned = await readPhotoSmartCollectionStorageContextV1(stores, catalog, signal);
			const definition = await readPhotoSmartCollectionDefinitionV1(stores, catalog, photoSmartCollectionKeyV1(catalog, selected.collectionId), signal);
			if (definition === null) throw new ReferenceError('Selected culling saved query is missing.');
			validatePhotoSmartCollectionReferencesV1(definition, owned.root); query = definition.query;
			savedProof = Object.freeze({ revision: definition.revision, state: owned.state.revision, digest: photoSavedDefinitionDigestV1(definition) });
		}
		const proof = Object.freeze({ root: root.revision, index: state.indexRevision, ...(savedProof ? { saved: savedProof } : {}) });
		if (progress.proof !== null && JSON.stringify(progress.proof) !== JSON.stringify(proof)) throw new PhotoCatalogRevisionConflictError('catalog');
		progress.proof = proof;
		const matches = query === null ? null : metadata ? photoQueryMatcherV2(root, query as PhotoCatalogQueryV2) : photoQueryMatcherV1(root, query);
		if (!plain) {
			const raw: unknown = await request(stores[buildStore].get(catalog));
			if (raw === undefined) throw new PhotoQueryIndexNotReadyError();
			const build = metadata ? readPhotoQueryBuildStateV2(raw, catalog) : readPhotoQueryBuildStateV1(raw, catalog);
			if (!build.ready) throw new PhotoQueryIndexNotReadyError();
			if (build.indexedCount !== root.photoCount) throw new TypeError('Ready culling index count disagrees with its catalog.');
		}
		const key = photoStorageKey(catalog, input.photoId), rawPhoto: unknown = await request(stores.photos.get(key));
		if (rawPhoto === undefined) return null;
		const photo = mode === 'legacy2' ? readStoredPhotoV1OrV2(rawPhoto, key) : readStoredPhotoCurrentV1(rawPhoto, key);
		const summary = readPhotoSummary(await request(stores.summaries.get(key)) as unknown);
		if (JSON.stringify(summary) !== JSON.stringify(photoSummary(photo))) throw new TypeError('Culling summary differs from its current Photo.');
		if (plain) {
			const rows = await readCursorPage(stores.summaries.index('catalogId'), { query: catalog, afterPrimaryKey: key, limit: 63,
				project: (raw, primaryKey) => { const row = readPhotoSummary(raw);
					if (row.catalogId !== catalog || row.key !== primaryKey) throw new TypeError('Culling scalar cursor identity disagrees.'); return row; } });
			const items = Object.freeze([summary, ...rows]), last = items.at(-1)!;
			return page(root.name, root.photoCount, items, items.length === 64 ? { catalogId: catalog, indexRevision: state.indexRevision, scope: `${catalog}|all`, afterKey: last.key } : null);
		}
		const rawRow: unknown = await request(stores[rowStore].get(key));
		const row = metadata ? readPhotoQueryRowV2(rawRow) : readPhotoQueryRowV1(rawRow);
		const projected = metadata ? projectPhotoQueryRowV2(photo) : projectPhotoQueryRowV1(photo);
		if (JSON.stringify(row) !== JSON.stringify(projected)) throw new TypeError('Culling point row differs from its current Photo.');
		if (!(matches as (value: typeof row) => boolean)(row)) return null;
		const position = Object.freeze({ captureBucket: query!.sort.field === 'capture-time' ? row.captureBucket : 0 as const, key: Object.freeze(metadata
			? photoQueryRowKeyV2(row as ReturnType<typeof readPhotoQueryRowV2>, query!.sort.field)
			: photoQueryRowKeyV1(row as ReturnType<typeof readPhotoQueryRowV1>, query!.sort.field)) });
		if (!selected.collapsed) {
			const result = metadata ? await readPhotoQueryPageInTransactionV2(stores, catalog, root, state, query as PhotoCatalogQueryV2, null,
				() => matches as ReturnType<typeof photoQueryMatcherV2>, signal, position)
				: await readPhotoQueryPageInTransactionV1(stores, catalog, root, state, query!, null, signal, position);
			if (result.items[0]?.photoId !== input.photoId) throw new TypeError('Culling inclusive index failed to deliver its admitted point row.');
			return page(root.name, root.photoCount, result.items, saved ? savedCursor(database, catalog, selected, query as PhotoCatalogQueryV2, proof, result.continuation, null) : result.continuation);
		}
		progress.start ??= { position, inclusivePending: true, auditComplete: false, stateRevision: null };
		const result = metadata ? await readPhotoStackQueryInTransaction(stores, root, state, catalog, query as PhotoCatalogQueryV2, progress.pending,
			{ rowStore: 'photoQueryRowsV2', buildStore: 'photoQueryBuildStatesV2', readRow: readPhotoQueryRowV2, readBuild: readPhotoQueryBuildStateV2,
				rowKey: photoQueryRowKeyV2, summarize: photoQuerySummaryV2, matcher: () => matches as ReturnType<typeof photoQueryMatcherV2>, issueProgress: item => item }, signal, progress.start)
			: await readPhotoStackQueryInTransaction(stores, root, state, catalog, query!, progress.pending,
				{ rowStore: 'photoQueryRows', buildStore: 'photoQueryBuildStates', readRow: readPhotoQueryRowV1, readBuild: readPhotoQueryBuildStateV1,
					rowKey: photoQueryRowKeyV1, summarize: item => item.summary, matcher: () => matches as ReturnType<typeof photoQueryMatcherV1>, issueProgress: item => item }, signal, progress.start);
		progress.pending = result.continuation;
		if (progress.start.inclusivePending || result.continuation?.pending?.photoId === input.photoId) return undefined;
		if (result.items[0]?.photoId !== input.photoId) return null;
		const next = result.continuation, cursor = saved ? savedCursor(database, catalog, selected, query as PhotoCatalogQueryV2, proof, next, result.stateRevision)
			: next === null ? null : metadata ? issuePhotoStackQueryProgressV2(database, { schemaVersion: 2, kind: 'collapsed-photo-query',
				...next, querySha256: photoQueryDigestV2(query as PhotoCatalogQueryV2) }, query as PhotoCatalogQueryV2)
				: issuePhotoStackQueryProgressV1(database, { schemaVersion: 1, kind: 'collapsed-photo-query', ...next, querySha256: photoQueryDigestV1(query!) }, query!);
		return page(root.name, root.photoCount, result.items, cursor);
	}, signal);
}

function savedCursor(database: IDBDatabase, catalogId: string, selected: Extract<PhotoLibraryCullingNavigationContextV1, { kind: 'saved' }>,
	query: PhotoCatalogQueryV2, proof: Proof, next: Readonly<{ captureBucket: 0 | 1; afterKey: readonly (string | number)[] | null }> | null, stackStateRevision: number | null) {
	if (next === null) return null;
	const pending = 'pending' in next ? (next as PhotoStackQueryKernelProgress).pending : null;
	const stackAudit = 'stackAudit' in next ? (next as PhotoStackQueryKernelProgress).stackAudit : null;
	return issuePhotoSavedQueryProgressV1(database, { schemaVersion: 1, kind: 'saved-photo-query', mode: selected.collapsed ? 'collapsed' : 'ordinary',
		catalogId, collectionId: selected.collectionId, definitionRevision: proof.saved!.revision, collectionStateRevision: proof.saved!.state,
		definitionSha256: proof.saved!.digest, querySha256: photoQueryDigestV2(query), catalogRevision: proof.root, indexRevision: proof.index,
		sort: query.sort, captureBucket: next.captureBucket, afterKey: next.afterKey, stackStateRevision, pending, stackAudit });
}
function page(catalogName: string, totalCount: number, items: readonly PhotoSummaryV1[], cursor: unknown): Readonly<PhotoLibraryPageV1> {
	return Object.freeze({ catalogName, totalCount, rows: Object.freeze(items.map(row => Object.freeze({ id: row.photoId, fileName: row.fileName,
		width: row.width, height: row.height, rating: row.rating, flag: row.flag, colorLabel: row.colorLabel }))), cursor: cursor === null ? null : JSON.stringify(cursor) });
}
