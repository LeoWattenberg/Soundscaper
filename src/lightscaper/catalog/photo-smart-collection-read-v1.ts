/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted } from './catalog-transaction.ts';
import { readPhotoSmartCollectionRecordV1 } from './photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionSummaryRecordV1 } from './photo-smart-collection-storage-v1.ts';
import type { PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import type { PhotoPredicateV2 } from './photo-smart-query-types-v2.ts';
import type { PhotoCatalogRootV1 } from './types.ts';

/** One exact definition/summary pair; absence is genuine only when both are absent. */
export async function readPhotoSmartCollectionDefinitionV1(stores: Readonly<Record<string, IDBObjectStore>>, catalogId: string,
	key: string, signal?: AbortSignal): Promise<Readonly<PhotoSmartCollectionV1> | null> {
	const raw: unknown = await request(stores.photoSmartCollections.get(key)); assertNotAborted(signal);
	const rawSummary: unknown = await request(stores.photoSmartCollectionSummaries.get(key)); assertNotAborted(signal);
	if (raw === undefined && rawSummary === undefined) return null;
	if (raw === undefined || rawSummary === undefined) throw new TypeError('Saved collection has an orphan definition or missing summary.');
	const definition = readPhotoSmartCollectionRecordV1(raw, catalogId, key), summary = readPhotoSmartCollectionSummaryRecordV1(rawSummary, catalogId, key);
	if (summary.name !== definition.name || summary.revision !== definition.revision) throw new TypeError('Saved collection summary disagrees with its definition.');
	return definition;
}

/** Validate all branches without allocating a second retained definition/projection. */
export function validatePhotoSmartCollectionReferencesV1(definition: PhotoSmartCollectionV1, root: PhotoCatalogRootV1): void {
	if (hasId(root.collections, definition.id)) throw new TypeError('Root and saved collection IDs must be disjoint.');
	function check(kind: 'folder' | 'keyword' | 'collection', target: string): void {
		const nodes = kind === 'folder' ? root.folders : kind === 'keyword' ? root.keywords : root.collections;
		if (!hasId(nodes, target)) throw new ReferenceError('Saved collection references a missing root definition.');
	}
	function visit(term: PhotoPredicateV2): void {
		switch (term.kind) {
			case 'all': case 'any': for (const child of term.terms) visit(child); break;
			case 'not': visit(term.term); break;
			case 'folder': case 'keyword': check(term.kind, term.id); break;
		}
	}
	const filter = definition.query.filter;
	if (filter?.kind === 'folder' || filter?.kind === 'keyword' || filter?.kind === 'collection') check(filter.kind, filter.id);
	if (definition.query.predicate !== null) visit(definition.query.predicate);
}
function hasId(nodes: readonly Readonly<{ id: string }>[], target: string): boolean {
	let lower = 0, upper = nodes.length;
	while (lower < upper) { const middle = Math.floor((lower + upper) / 2), node = nodes[middle]!;
		if (node.id === target) return true; if (node.id < target) lower = middle + 1; else upper = middle; }
	return false;
}
