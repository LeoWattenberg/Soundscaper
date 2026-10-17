/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { PhotoCatalogRevisionConflictError } from '../catalog/repository-types.ts';
import { normalizePhotoSmartQueryV1 } from '../catalog/smart-query.ts';
import type { PhotoCatalogRootV1, PhotoCollectionV1, PhotoHierarchyNodeV1 } from '../catalog/types.ts';
import { field, id, integer, name, oneOf, record } from '../catalog/value-validation.ts';

export const PHOTO_CATALOG_DEFINITION_LIMITS_V1 = Object.freeze({ pageSize: 64, maximumContinuationBytes: 1_024 });

export type PhotoCatalogHierarchyKindV1 = 'folder' | 'keyword';
export type PhotoCatalogDefinitionKindV1 = PhotoCatalogHierarchyKindV1 | 'collection';

export type PhotoCatalogDefinitionCommandV1 =
	| Readonly<{ type: 'create-node'; nodeKind: PhotoCatalogHierarchyKindV1; id: string; name: string; parentId: string | null }>
	| Readonly<{ type: 'rename-node'; nodeKind: PhotoCatalogHierarchyKindV1; id: string; name: string }>
	| Readonly<{ type: 'reparent-node'; nodeKind: PhotoCatalogHierarchyKindV1; id: string; parentId: string | null }>
	| Readonly<{ type: 'delete-empty-node'; nodeKind: PhotoCatalogHierarchyKindV1; id: string }>
	| Readonly<{ type: 'create-collection' | 'update-collection'; collection: PhotoCollectionV1 }>;

export type PhotoCatalogDefinitionRowV1 =
	| Readonly<{ kind: PhotoCatalogHierarchyKindV1; id: string; name: string; parentId: string | null }>
	| Readonly<{ kind: 'collection'; id: string; name: string; collectionKind: 'manual' | 'smart' }>;

export interface PhotoCatalogDefinitionContinuationV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly rootRevision: number;
	readonly kind: PhotoCatalogDefinitionKindV1;
	readonly parentId: string | null;
	readonly afterId: string;
}

export type PhotoCatalogDefinitionPageRequestV1 =
	| Readonly<{ kind: PhotoCatalogHierarchyKindV1; parentId: string | null; continuation?: PhotoCatalogDefinitionContinuationV1 | null }>
	| Readonly<{ kind: 'collection'; continuation?: PhotoCatalogDefinitionContinuationV1 | null }>;

export interface PhotoCatalogDefinitionPageV1 {
	readonly catalogId: string;
	readonly rootRevision: number;
	readonly items: readonly PhotoCatalogDefinitionRowV1[];
	readonly continuation: PhotoCatalogDefinitionContinuationV1 | null;
}

const COMMAND_TYPES = ['create-node', 'rename-node', 'reparent-node', 'delete-empty-node', 'create-collection', 'update-collection'] as const;
const DEFINITION_KINDS = ['folder', 'keyword', 'collection'] as const;

/** A fresh-root draft only; saveCatalog owns atomic membership checks and revision publication. */
export function applyPhotoCatalogDefinitionCommandV1(value: unknown, expectedRevision: unknown, command: unknown): PhotoCatalogRootV1 {
	const root = readRoot(value);
	if (root.revision !== integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'expected catalog revision')) {
		throw new PhotoCatalogRevisionConflictError('catalog');
	}
	const input = record(command, 'catalog definition command', ['type', 'nodeKind', 'id', 'name', 'parentId', 'collection'], ['type']);
	const type = oneOf(field(input, 'type'), COMMAND_TYPES, 'catalog definition command type');
	let draft: PhotoCatalogRootV1;
	if (type === 'create-collection' || type === 'update-collection') {
		record(input, 'collection definition command', ['type', 'collection']);
		const collection = readCollection(field(input, 'collection'));
		const previous = root.collections.find((entry) => entry.id === collection.id);
		if (type === 'create-collection') {
			if (previous) throw new RangeError('Collection ID already exists.');
			draft = { ...root, collections: [...root.collections, collection] };
		} else {
			if (!previous) throw new ReferenceError('Collection is missing.');
			if (previous.kind !== collection.kind) throw new RangeError('Collection updates must preserve manual or smart kind.');
			draft = { ...root, collections: root.collections.map((entry) => entry.id === collection.id ? collection : entry) };
		}
	} else {
		const allowed = type === 'create-node' ? ['type', 'nodeKind', 'id', 'name', 'parentId']
			: type === 'rename-node' ? ['type', 'nodeKind', 'id', 'name']
				: type === 'reparent-node' ? ['type', 'nodeKind', 'id', 'parentId'] : ['type', 'nodeKind', 'id'];
		record(input, 'hierarchy definition command', allowed);
		const kind = oneOf(field(input, 'nodeKind'), ['folder', 'keyword'] as const, 'hierarchy definition kind');
		const nodeId = id(field(input, 'id'), 'definition ID');
		const nodes = kind === 'folder' ? root.folders : root.keywords;
		const previous = nodes.find((entry) => entry.id === nodeId);
		let next: readonly PhotoHierarchyNodeV1[];
		if (type === 'create-node') {
			if (previous) throw new RangeError('Hierarchy definition ID already exists.');
			next = [...nodes, { id: nodeId, name: name(field(input, 'name'), 'definition name'), parentId: readParent(field(input, 'parentId')) }];
		} else {
			if (!previous) throw new ReferenceError('Hierarchy definition is missing.');
			if (type === 'delete-empty-node') {
				if (nodes.some((entry) => entry.parentId === nodeId)) throw new ReferenceError('Cannot delete a definition with children.');
				next = nodes.filter((entry) => entry.id !== nodeId);
			} else {
				const replacement = type === 'rename-node'
					? { ...previous, name: name(field(input, 'name'), 'definition name') }
					: { ...previous, parentId: readParent(field(input, 'parentId')) };
				next = nodes.map((entry) => entry.id === nodeId ? replacement : entry);
			}
		}
		draft = kind === 'folder' ? { ...root, folders: next } : { ...root, keywords: next };
	}
	const candidate = readRoot(draft);
	// Even a candidate exactly at 2 MiB can overflow when revision 9 becomes 10.
	readRoot({ ...candidate, revision: root.revision + 1 });
	return candidate;
}

/** Canonical scalar pages in one explicit immediate-parent scope, never descendant membership. */
export function readPhotoCatalogDefinitionPageV1(value: unknown, request: unknown): PhotoCatalogDefinitionPageV1 {
	const root = readRoot(value);
	const input = record(request, 'definition page request', ['kind', 'parentId', 'continuation'], ['kind']);
	const kind = oneOf(field(input, 'kind'), DEFINITION_KINDS, 'definition page kind');
	const hierarchy = kind === 'collection' ? null : kind === 'folder' ? root.folders : root.keywords;
	record(input, 'definition page scope', hierarchy ? ['kind', 'parentId', 'continuation'] : ['kind', 'continuation'], hierarchy ? ['kind', 'parentId'] : ['kind']);
	const parentId = hierarchy ? readParent(field(input, 'parentId')) : null;
	if (hierarchy && parentId !== null && !hierarchy.some((node) => node.id === parentId)) throw new ReferenceError('Definition page parent is missing.');
	const rawCursor = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : null;
	const cursor = rawCursor === null ? null : readContinuation(rawCursor, root, kind, parentId);
	const entries = hierarchy ?? root.collections;
	if (cursor && !entries.some((entry) => entry.id === cursor.afterId && inScope(entry, parentId))) {
		throw new ReferenceError('Definition continuation refers to a missing node in this scope.');
	}
	const items: PhotoCatalogDefinitionRowV1[] = [];
	let more = false;
	for (const entry of entries) {
		if (cursor && entry.id <= cursor.afterId || !inScope(entry, parentId)) continue;
		if (items.length === PHOTO_CATALOG_DEFINITION_LIMITS_V1.pageSize) { more = true; break; }
		if ('parentId' in entry) {
			if (kind === 'collection') throw new TypeError('Collection page contains a hierarchy node.');
			items.push(Object.freeze({ kind, id: entry.id, name: entry.name, parentId: entry.parentId }));
		} else {
			items.push(Object.freeze({ kind: 'collection', id: entry.id, name: entry.name, collectionKind: entry.kind }));
		}
	}
	const last = items.at(-1);
	const continuation = more && last ? readContinuation({ schemaVersion: 1, catalogId: root.id,
		rootRevision: root.revision, kind, parentId, afterId: last.id }, root, kind, parentId) : null;
	return Object.freeze({ catalogId: root.id, rootRevision: root.revision, items: Object.freeze(items), continuation });
}

function readRoot(value: unknown): PhotoCatalogRootV1 {
	const root = validateLightscaperDocumentV1(value);
	if (root.kind !== 'photo-catalog') throw new TypeError('Definition commands and projections require a catalog root.');
	return root;
}

function readParent(value: unknown): string | null { return value === null ? null : id(value, 'definition parent ID'); }

function readCollection(value: unknown): PhotoCollectionV1 {
	const input = record(value, 'collection definition', ['id', 'name', 'kind', 'query'], ['id', 'name', 'kind']);
	const kind = oneOf(field(input, 'kind'), ['manual', 'smart'] as const, 'collection definition kind');
	const common = { id: id(field(input, 'id'), 'collection ID'), name: name(field(input, 'name'), 'collection name') };
	if (kind === 'manual') {
		record(input, 'manual collection definition', ['id', 'name', 'kind']);
		return Object.freeze({ ...common, kind });
	}
	return Object.freeze({ ...common, kind, query: normalizePhotoSmartQueryV1(field(input, 'query')) });
}

function inScope(entry: PhotoHierarchyNodeV1 | PhotoCollectionV1, parentId: string | null): boolean {
	return !('parentId' in entry) || entry.parentId === parentId;
}

function readContinuation(value: unknown, root: PhotoCatalogRootV1, kind: PhotoCatalogDefinitionKindV1, parentId: string | null): PhotoCatalogDefinitionContinuationV1 {
	const input = record(value, 'definition continuation', ['schemaVersion', 'catalogId', 'rootRevision', 'kind', 'parentId', 'afterId']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future definition continuation.');
	const catalogId = id(field(input, 'catalogId'), 'continuation catalog ID');
	const revision = integer(field(input, 'rootRevision'), 0, Number.MAX_SAFE_INTEGER, 'continuation root revision');
	const cursorKind = oneOf(field(input, 'kind'), DEFINITION_KINDS, 'continuation definition kind');
	const cursorParent = readParent(field(input, 'parentId'));
	const afterId = id(field(input, 'afterId'), 'continuation definition ID');
	if (catalogId !== root.id || cursorKind !== kind || cursorParent !== parentId) throw new TypeError('Definition continuation belongs to another catalog or scope.');
	if (revision !== root.revision) throw new PhotoCatalogRevisionConflictError('catalog');
	const continuation = Object.freeze({ schemaVersion: 1 as const, catalogId, rootRevision: revision, kind, parentId, afterId });
	if (new TextEncoder().encode(JSON.stringify(continuation)).byteLength > PHOTO_CATALOG_DEFINITION_LIMITS_V1.maximumContinuationBytes) {
		throw new RangeError('Definition continuation exceeds its byte budget.');
	}
	return continuation;
}
