/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryQueryV2 } from '../../photo-library-query-port-v2.ts';
import type { PhotoLibraryPageV1, PhotoLibraryQueryStepV1, PhotoLibraryQueryV1,
	PhotoLibrarySessionPortV1 } from '../../photo-library-session-port-v1.ts';

export type PhotoLibraryQueryNavigationPort = Pick<PhotoLibrarySessionPortV1,
	'readPage' | 'readQueryStep' | 'readStackQueryStep' | 'readQueryStepV2' | 'readStackQueryStepV2' | 'savedCollections'>;
export interface PhotoLibraryQueryNavigationContext {
	readonly query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2 | null;
	readonly stackCollapsed: boolean;
	readonly savedCollectionId?: string | null;
}

export const DEFAULT_PHOTO_LIBRARY_QUERY_V1: PhotoLibraryQueryV1 = Object.freeze({ text: '', filter: null,
	sort: Object.freeze({ field: 'photo-id', direction: 'ascending' }) });
export const DEFAULT_PHOTO_LIBRARY_QUERY_V2: PhotoLibraryQueryV2 = Object.freeze({ schemaVersion: 2, kind: 'photo-catalog-query',
	...DEFAULT_PHOTO_LIBRARY_QUERY_V1, predicate: null });

/** Borrow the current session; plain paging keeps its existing direct result. */
export function readVisiblePage(owner: PhotoLibraryQueryNavigationPort, current: PhotoLibraryQueryNavigationContext,
	cursor: string | null, signal: AbortSignal): Promise<PhotoLibraryPageV1> {
	const collectionId = current.savedCollectionId;
	if (collectionId !== undefined && collectionId !== null) {
		const saved = owner.savedCollections;
		if (!saved) throw new Error('Saved photo filters are unavailable.');
		const mode = current.stackCollapsed ? 'collapsed' : 'ordinary';
		return readNonemptyPage(nextCursor => saved.readQueryStep({ collectionId, mode, cursor: nextCursor, signal }), cursor, signal);
	}
	return current.query || current.stackCollapsed ? readNonemptyQueryPage(owner, current.query ?? DEFAULT_PHOTO_LIBRARY_QUERY_V2, cursor, signal, current.stackCollapsed)
		: owner.readPage({ cursor, signal });
}

/** Empty bounded query steps yield before continuing; the published page omits scanner bookkeeping. */
export function readNonemptyQueryPage(owner: PhotoLibraryQueryNavigationPort, query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2,
	cursor: string | null, signal: AbortSignal, collapsed = false): Promise<PhotoLibraryPageV1> {
	return readNonemptyPage(nextCursor => readQueryStep(owner, query, nextCursor, signal, collapsed), cursor, signal);
}

async function readNonemptyPage(read: (cursor: string | null) => Promise<PhotoLibraryQueryStepV1>,
	cursor: string | null, signal: AbortSignal): Promise<PhotoLibraryPageV1> {
	while (true) {
		signal.throwIfAborted(); const next = await read(cursor); signal.throwIfAborted();
		if (next.rows.length > 0 || next.cursor === null) return Object.freeze({
			catalogName: next.catalogName, totalCount: next.totalCount, rows: next.rows, cursor: next.cursor,
		});
		if (next.cursor === cursor) throw new Error('Photo query continuation did not advance.');
		cursor = next.cursor; await yieldTask(signal);
	}
}

export function isMetadataQuery(query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2): query is PhotoLibraryQueryV2 { return 'schemaVersion' in query; }

export function readQueryStep(owner: PhotoLibraryQueryNavigationPort, query: PhotoLibraryQueryV1 | PhotoLibraryQueryV2,
	cursor: string | null, signal: AbortSignal, collapsed: boolean): Promise<PhotoLibraryQueryStepV1> {
	if (isMetadataQuery(query)) return collapsed ? owner.readStackQueryStepV2({ query, cursor, signal }) : owner.readQueryStepV2({ query, cursor, signal });
	return collapsed ? owner.readStackQueryStep({ query, cursor, signal }) : owner.readQueryStep({ query, cursor, signal });
}

export async function yieldTask(signal: AbortSignal): Promise<void> {
	await new Promise<void>(resolve => { setTimeout(resolve, 0); }); signal.throwIfAborted();
}
