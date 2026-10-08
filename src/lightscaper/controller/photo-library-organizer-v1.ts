/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDefinitionAcknowledgementV1, PhotoLibraryDefinitionCommandV1,
	PhotoLibraryDefinitionReadRequestV1, PhotoLibraryDefinitionSnapshotV1 } from '../../common/editor/photo-library-organization-port-v1.ts';
import type { PhotoLibraryDefinitionKindV1, PhotoLibraryDefinitionRowV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import { normalizePhotoSmartQueryV1 } from '../catalog/smart-query.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoCatalogRootV1 } from '../catalog/types.ts';
import { field, id, integer, name, oneOf, record } from '../catalog/value-validation.ts';
import { applyPhotoCatalogDefinitionCommandV1 } from './photo-catalog-definitions.ts';
import { admitPhotoLibraryQueryBuildRequestV1 } from './photo-library-query-v1.ts';

const kinds = ['folder', 'keyword', 'collection'] as const;
const types = ['create-node', 'rename-node', 'reparent-node', 'delete-empty-node', 'create-collection', 'update-collection'] as const;

/** Closed scalar request admission; session composition calls this before opening resources. */
export function normalizePhotoLibraryDefinitionReadRequestV1(value: unknown): PhotoLibraryDefinitionReadRequestV1 {
	const input = record(value, 'definition read request', ['kind', 'id', 'signal'], ['kind', 'id']);
	return Object.freeze({ ...signalFor(input), kind: oneOf(field(input, 'kind'), kinds, 'definition kind'), id: id(field(input, 'id'), 'definition ID') });
}

/** Complete existing grammar, passed as bounded inert JSON rather than a product type in common UI. */
export function normalizePhotoLibraryDefinitionCommandV1(value: unknown): PhotoLibraryDefinitionCommandV1 {
	const input = record(value, 'definition authoring command', ['type', 'nodeKind', 'id', 'name', 'parentId', 'collection'], ['type']);
	const type = oneOf(field(input, 'type'), types, 'definition command type');
	if (type === 'create-collection' || type === 'update-collection') {
		record(input, 'collection authoring command', ['type', 'collection']);
		const entry = record(field(input, 'collection'), 'collection authoring definition', ['id', 'name', 'kind', 'queryJson'], ['id', 'name', 'kind']);
		const kind = oneOf(field(entry, 'kind'), ['manual', 'smart'] as const, 'collection kind');
		const common = { id: id(field(entry, 'id'), 'collection ID'), name: name(field(entry, 'name'), 'collection name') };
		if (kind === 'manual') {
			record(entry, 'manual collection definition', ['id', 'name', 'kind']);
			return Object.freeze({ type, collection: Object.freeze({ ...common, kind }) });
		}
		const source = field(entry, 'queryJson');
		if (typeof source !== 'string' || source.length > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes
			|| new TextEncoder().encode(source).byteLength > LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes) {
			throw new RangeError('Smart query JSON exceeds the document byte bound.');
		}
		const query = normalizePhotoSmartQueryV1(JSON.parse(source) as unknown);
		return Object.freeze({ type, collection: Object.freeze({ ...common, kind, queryJson: JSON.stringify(query) }) });
	}
	const keys = type === 'create-node' ? ['type', 'nodeKind', 'id', 'name', 'parentId']
		: type === 'rename-node' ? ['type', 'nodeKind', 'id', 'name']
			: type === 'reparent-node' ? ['type', 'nodeKind', 'id', 'parentId'] : ['type', 'nodeKind', 'id'];
	record(input, 'hierarchy authoring command', keys);
	const common = { nodeKind: oneOf(field(input, 'nodeKind'), ['folder', 'keyword'] as const, 'hierarchy kind'), id: id(field(input, 'id'), 'definition ID') };
	if (type === 'delete-empty-node') return Object.freeze({ type, ...common });
	if (type === 'rename-node') return Object.freeze({ type, ...common, name: name(field(input, 'name'), 'definition name') });
	const parent = field(input, 'parentId'), parentId = parent === null ? null : id(parent, 'definition parent ID');
	return type === 'reparent-node' ? Object.freeze({ type, ...common, parentId })
		: Object.freeze({ type, ...common, parentId, name: name(field(input, 'name'), 'definition name') });
}

export function normalizePhotoLibraryDefinitionMutationV1(expectedRootRevision: unknown, command: unknown, options: unknown = {}) {
	const admitted = admitPhotoLibraryQueryBuildRequestV1(options);
	return Object.freeze({ ...admitted, expectedRootRevision: integer(expectedRootRevision, 0, Number.MAX_SAFE_INTEGER, 'expected root revision'),
		command: normalizePhotoLibraryDefinitionCommandV1(command) });
}

export async function readPhotoLibraryDefinitionV1(
	repository: Pick<PhotoCatalogRepositoryV1, 'loadCatalog'>, catalogId: string, request: unknown,
): Promise<PhotoLibraryDefinitionSnapshotV1> {
	const catalog = id(catalogId, 'catalog ID'), admitted = normalizePhotoLibraryDefinitionReadRequestV1(request);
	const root = await readRoot(repository, catalog, admitted);
	const row = definitionRow(root, admitted.kind, admitted.id);
	if (!row) throw new ReferenceError('The selected definition is missing.');
	const collection = admitted.kind === 'collection' ? root.collections.find(entry => entry.id === admitted.id) : null;
	return Object.freeze({ rootRevision: root.revision, row,
		queryJson: collection?.kind === 'smart' ? JSON.stringify(collection.query, null, 2) : null });
}

/** One current-root draft and CAS. A successful durable acknowledgment outranks late cancellation. */
export async function applyPhotoLibraryDefinitionV1(
	repository: Pick<PhotoCatalogRepositoryV1, 'loadCatalog' | 'saveCatalog'>, catalogId: string,
	expectedRootRevision: unknown, command: unknown, options: unknown = {},
): Promise<PhotoLibraryDefinitionAcknowledgementV1> {
	const catalog = id(catalogId, 'catalog ID'), admitted = normalizePhotoLibraryDefinitionMutationV1(expectedRootRevision, command, options);
	const root = await readRoot(repository, catalog, admitted), input = admitted.command;
	const authored = 'collection' in input && input.collection.kind === 'smart'
		? { type: input.type, collection: { id: input.collection.id, name: input.collection.name, kind: 'smart',
			query: normalizePhotoSmartQueryV1(JSON.parse(input.collection.queryJson) as unknown) } } : input;
	const draft = applyPhotoCatalogDefinitionCommandV1(root, admitted.expectedRootRevision, authored);
	const saved = await repository.saveCatalog(draft, admitted.expectedRootRevision, { signal: admitted.signal });
	const kind = 'collection' in input ? 'collection' : input.nodeKind, key = 'collection' in input ? input.collection.id : input.id;
	return Object.freeze({ rootRevision: saved.revision, row: definitionRow(saved, kind, key) });
}

async function readRoot(repository: Pick<PhotoCatalogRepositoryV1, 'loadCatalog'>, catalogId: string, options: Readonly<{ signal?: AbortSignal }>): Promise<PhotoCatalogRootV1> {
	const value = await repository.loadCatalog(catalogId); admitPhotoLibraryQueryBuildRequestV1({ signal: options.signal });
	const root = validateLightscaperDocumentV1(value);
	if (root.kind !== 'photo-catalog' || root.id !== catalogId) throw new TypeError('Organization requires the selected catalog root.');
	return root;
}

function definitionRow(root: PhotoCatalogRootV1, kind: PhotoLibraryDefinitionKindV1, key: string): PhotoLibraryDefinitionRowV1 | null {
	if (kind === 'collection') {
		const entry = root.collections.find(candidate => candidate.id === key);
		return entry ? Object.freeze({ kind, id: entry.id, name: entry.name, collectionKind: entry.kind }) : null;
	}
	const entry = (kind === 'folder' ? root.folders : root.keywords).find(candidate => candidate.id === key);
	return entry ? Object.freeze({ kind, id: entry.id, name: entry.name, parentId: entry.parentId }) : null;
}

function signalFor(input: Readonly<Record<string, unknown>>) {
	return admitPhotoLibraryQueryBuildRequestV1(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal') } : {});
}
