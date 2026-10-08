/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDefinitionPageRequestV1, PhotoLibraryDefinitionPageV1, PhotoLibraryDefinitionRowV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import { field, id, integer, oneOf, record } from '../catalog/value-validation.ts';
import { PHOTO_CATALOG_DEFINITION_LIMITS_V1, readPhotoCatalogDefinitionPageV1 } from './photo-catalog-definitions.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from './photo-library-query-v1.ts';

/** Validate scalar requests before the session opens any catalog or media owner. */
export function admitPhotoLibraryDefinitionPageRequestV1(value: unknown): Readonly<PhotoLibraryDefinitionPageRequestV1> {
	const input = record(value, 'photo definition request', ['kind', 'parentId', 'selectedId', 'cursor', 'signal'], ['kind']);
	const kind = oneOf(field(input, 'kind'), ['folder', 'keyword', 'collection'] as const, 'definition kind');
	const parentValue = Object.hasOwn(input, 'parentId') ? field(input, 'parentId') : null;
	const parentId = parentValue === null ? null : id(parentValue, 'definition parent ID');
	if (kind === 'collection' && parentId !== null) throw new TypeError('Collection definitions have no hierarchy parent.');
	const selectedValue = Object.hasOwn(input, 'selectedId') ? field(input, 'selectedId') : null;
	const selectedId = selectedValue === null ? null : id(selectedValue, 'selected definition ID');
	const cursorValue = Object.hasOwn(input, 'cursor') ? field(input, 'cursor') : null;
	let cursor: string | null = null;
	if (cursorValue !== null && cursorValue !== undefined) {
		if (typeof cursorValue !== 'string' || new TextEncoder().encode(cursorValue).byteLength > PHOTO_CATALOG_DEFINITION_LIMITS_V1.maximumContinuationBytes) {
			throw new RangeError('Definition cursor exceeds its scalar byte bound.');
		}
		const candidate = record(JSON.parse(cursorValue) as unknown, 'definition cursor', ['schemaVersion', 'catalogId', 'rootRevision', 'kind', 'parentId', 'afterId']);
		if (field(candidate, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future definition continuation.');
		id(field(candidate, 'catalogId'), 'cursor catalog ID'); integer(field(candidate, 'rootRevision'), 0, Number.MAX_SAFE_INTEGER, 'cursor root revision');
		if (field(candidate, 'kind') !== kind || field(candidate, 'parentId') !== parentId) throw new TypeError('Definition cursor belongs to another scope.');
		id(field(candidate, 'afterId'), 'cursor definition ID'); cursor = cursorValue;
	}
	const { signal } = admitPhotoLibraryQueryBuildRequestV1({ signal: Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined });
	return Object.freeze({ kind, parentId, selectedId, cursor, ...(signal ? { signal } : {}) });
}

/** One current parent and selected label, from the same bounded fresh root as the page. */
export async function readPhotoLibraryDefinitionPageV1(
	repository: Pick<PhotoCatalogRepositoryV1, 'loadCatalog'>, catalogId: string, request: unknown,
): Promise<PhotoLibraryDefinitionPageV1> {
	const catalog = id(catalogId, 'catalog ID'), admitted = admitPhotoLibraryDefinitionPageRequestV1(request);
	const value = await repository.loadCatalog(catalog);
	admitPhotoLibraryQueryBuildRequestV1({ signal: admitted.signal });
	const root = validateLightscaperDocumentV1(value);
	if (root.kind !== 'photo-catalog' || root.id !== catalog) throw new TypeError('Definition pages require the selected catalog root.');
	const continuation: unknown = admitted.cursor ? JSON.parse(admitted.cursor) : null;
	const scope = admitted.kind === 'collection' ? { kind: admitted.kind, continuation } : { kind: admitted.kind, parentId: admitted.parentId, continuation };
	const page = readPhotoCatalogDefinitionPageV1(root, scope);
	const nodes = admitted.kind === 'folder' ? root.folders : admitted.kind === 'keyword' ? root.keywords : null;
	const parent = nodes?.find(node => node.id === admitted.parentId) ?? null;
	let selected: PhotoLibraryDefinitionRowV1 | null = null;
	if (admitted.selectedId) {
		if (nodes) {
			const node = nodes.find(candidate => candidate.id === admitted.selectedId);
			if (node && admitted.kind !== 'collection') selected = Object.freeze({ kind: admitted.kind, ...node });
		} else {
			const collection = root.collections.find(candidate => candidate.id === admitted.selectedId);
			if (collection) selected = Object.freeze({ kind: 'collection', id: collection.id, name: collection.name, collectionKind: collection.kind });
		}
		if (!selected) throw new ReferenceError('Selected catalog definition is missing.');
	}
	return Object.freeze({ rootRevision: page.rootRevision, rows: page.items, parent, selected,
		cursor: page.continuation === null ? null : JSON.stringify(page.continuation) });
}
