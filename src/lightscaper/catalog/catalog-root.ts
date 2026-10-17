/* SPDX-License-Identifier: AGPL-3.0-only */

import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type PhotoCatalogRootV1, type PhotoCollectionV1, type PhotoHierarchyNodeV1 } from './types.ts';
import { normalizePhotoSmartQueryV1, validatePhotoQueryReferencesV1 } from './smart-query.ts';
import { array, compareText, field, id, integer, name, oneOf, record, requireSchema, unique } from './value-validation.ts';

export function normalizePhotoCatalogRootV1(value: unknown): PhotoCatalogRootV1 {
	const input = record(value, 'photo catalog', ['schemaFamily', 'schemaVersion', 'kind', 'id', 'name', 'revision', 'photoCount', 'folders', 'keywords', 'collections']);
	requireSchema(input);
	oneOf(field(input, 'kind'), ['photo-catalog'] as const, 'catalog kind');
	const folders = normalizeHierarchy(field(input, 'folders'), 'catalog folders', LIMITS.maximumFolders);
	const keywords = normalizeHierarchy(field(input, 'keywords'), 'catalog keywords', LIMITS.maximumKeywords);
	const collections = normalizeCollections(field(input, 'collections'));
	const folderIds = new Set(folders.map((folder) => folder.id));
	const keywordIds = new Set(keywords.map((keyword) => keyword.id));
	for (const collection of collections) {
		if (collection.kind === 'smart') validatePhotoQueryReferencesV1(collection.query, folderIds, keywordIds);
	}
	return Object.freeze({
		schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: id(field(input, 'id'), 'catalog ID'),
		name: name(field(input, 'name'), 'catalog name'),
		revision: integer(field(input, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'catalog revision'),
		photoCount: integer(field(input, 'photoCount'), 0, LIMITS.maximumPhotos, 'catalog photo count'),
		folders, keywords, collections,
	});
}

function normalizeHierarchy(value: unknown, label: string, maximum: number): readonly PhotoHierarchyNodeV1[] {
	const nodes = array(value, label, 0, maximum).map((candidate) => {
		const input = record(candidate, label, ['id', 'name', 'parentId']);
		const parent = field(input, 'parentId');
		return Object.freeze({
			id: id(field(input, 'id'), `${label} ID`),
			name: name(field(input, 'name'), `${label} name`),
			parentId: parent === null ? null : id(parent, `${label} parent ID`),
		});
	});
	unique(nodes.map((node) => node.id), label);
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const visited = new Set<string>();
	// Iterative linear-time forest validation supports deep keyword hierarchies
	// without recursion or repeatedly walking already validated parent chains.
	for (const node of nodes) {
		const path = new Set<string>();
		let current: PhotoHierarchyNodeV1 | undefined = node;
		while (current && !visited.has(current.id)) {
			if (path.has(current.id)) throw new RangeError(`${label} contains a cycle.`);
			path.add(current.id);
			if (current.parentId === null) break;
			const parent = byId.get(current.parentId);
			if (!parent) throw new ReferenceError(`${label} references a missing parent.`);
			current = parent;
		}
		for (const key of path) visited.add(key);
	}
	return Object.freeze(nodes.sort((left, right) => compareText(left.id, right.id)));
}

function normalizeCollections(value: unknown): readonly PhotoCollectionV1[] {
	const collections = array(value, 'catalog collections', 0, LIMITS.maximumCollections).map((candidate): PhotoCollectionV1 => {
		const input = record(candidate, 'catalog collection', ['id', 'name', 'kind', 'query'], ['id', 'name', 'kind']);
		const kind = oneOf(field(input, 'kind'), ['manual', 'smart'] as const, 'collection kind');
		const common = { id: id(field(input, 'id'), 'collection ID'), name: name(field(input, 'name'), 'collection name') };
		if (kind === 'manual') {
			record(input, 'manual collection', ['id', 'name', 'kind']);
			return Object.freeze({ ...common, kind });
		}
		return Object.freeze({ ...common, kind, query: normalizePhotoSmartQueryV1(field(input, 'query')) });
	});
	unique(collections.map((collection) => collection.id), 'catalog collections');
	return Object.freeze(collections.sort((left, right) => compareText(left.id, right.id)));
}
