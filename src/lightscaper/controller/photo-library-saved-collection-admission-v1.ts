/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1 as LIMITS,
	type PhotoLibrarySavedCollectionContextV1 } from '../../common/editor/photo-library-saved-collection-port-v1.ts';
import { admitPhotoSmartCollectionSaveV1, readPhotoSmartCollectionPageOptionsV1,
	type PhotoSmartCollectionContinuationV1 } from '../catalog/photo-smart-collection-repository-types-v1.ts';
import { readPhotoSavedQueryContinuationV1, type PhotoSavedQueryContinuationV1,
	type PhotoSavedQueryModeV1 } from '../catalog/photo-smart-collection-query-types-v1.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import { assertPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { field, id, integer, name, oneOf, record } from '../catalog/value-validation.ts';

export interface AdmittedPhotoLibrarySavedPageRequestV1 {
	readonly continuation: PhotoSmartCollectionContinuationV1 | null;
	readonly signal?: AbortSignal;
}
export interface AdmittedPhotoLibrarySavedSnapshotRequestV1 {
	readonly collectionId: string | null;
	readonly signal?: AbortSignal;
}
export interface AdmittedPhotoLibrarySavedQueryRequestV1 {
	readonly collectionId: string;
	readonly mode: PhotoSavedQueryModeV1;
	readonly continuation: PhotoSavedQueryContinuationV1 | null;
	readonly signal?: AbortSignal;
}
export interface AdmittedPhotoLibrarySavedCommandV1 {
	readonly type: 'create' | 'update' | 'delete';
	readonly context: PhotoLibrarySavedCollectionContextV1;
	readonly collectionId: string;
	readonly expectedDefinitionRevision: number | null;
	readonly definition: Readonly<PhotoSmartCollectionV1> | null;
}
const pages = new WeakSet<object>(), snapshots = new WeakSet<object>(), queries = new WeakSet<object>(), commands = new WeakSet<object>();
const savedCursorFields = ['schemaVersion', 'kind', 'mode', 'catalogId', 'collectionId', 'definitionRevision', 'collectionStateRevision',
	'definitionSha256', 'querySha256', 'catalogRevision', 'indexRevision', 'sort', 'captureBucket', 'afterKey', 'stackStateRevision',
	'pending', 'stackAudit', 'progressSha256'] as const;

/** Closed scalar admission precedes lazy resources. A cursor carries navigation, never write authority. */
export function admitPhotoLibrarySavedPageRequestV1(value: unknown = {}): AdmittedPhotoLibrarySavedPageRequestV1 {
	if (branded(pages, value)) return value as AdmittedPhotoLibrarySavedPageRequestV1;
	const input = record(value, 'saved page request', ['cursor', 'signal'], []), signal = readSignal(input);
	const raw = optionalCursor(input); let continuation: PhotoSmartCollectionContinuationV1 | null = null;
	if (raw !== null) {
		const parsed = record(parseCursor(raw), 'saved page cursor', ['schemaVersion', 'kind', 'scope', 'catalogId',
			'catalogRevision', 'indexRevision', 'stateRevision', 'afterKey']);
		continuation = readPhotoSmartCollectionPageOptionsV1({ continuation: parsed }, id(field(parsed, 'catalogId'), 'cursor catalog ID')).continuation;
	}
	return brand(pages, Object.freeze({ continuation, ...signal }));
}
export function admitPhotoLibrarySavedSnapshotRequestV1(value: unknown): AdmittedPhotoLibrarySavedSnapshotRequestV1 {
	if (branded(snapshots, value)) return value as AdmittedPhotoLibrarySavedSnapshotRequestV1;
	const input = record(value, 'saved snapshot request', ['collectionId', 'signal'], ['collectionId']), signal = readSignal(input);
	const selected = field(input, 'collectionId');
	return brand(snapshots, Object.freeze({ collectionId: selected === null ? null : id(selected, 'saved selection ID'), ...signal }));
}
export function admitPhotoLibrarySavedQueryRequestV1(value: unknown): AdmittedPhotoLibrarySavedQueryRequestV1 {
	if (branded(queries, value)) return value as AdmittedPhotoLibrarySavedQueryRequestV1;
	const input = record(value, 'saved query request', ['collectionId', 'mode', 'cursor', 'signal'], ['collectionId', 'mode']);
	const signal = readSignal(input), collectionId = id(field(input, 'collectionId'), 'saved query selection ID');
	const mode = oneOf(field(input, 'mode'), ['ordinary', 'collapsed'] as const, 'saved query mode');
	const raw = optionalCursor(input); let continuation: PhotoSavedQueryContinuationV1 | null = null;
	if (raw !== null) {
		const parsed = record(parseCursor(raw), 'saved query cursor', savedCursorFields);
		continuation = readPhotoSavedQueryContinuationV1(parsed, id(field(parsed, 'catalogId'), 'cursor catalog ID'), collectionId, mode);
	}
	return brand(queries, Object.freeze({ collectionId, mode, continuation, ...signal }));
}
export function admitPhotoLibrarySavedSignalV1(value: unknown = {}): Readonly<{ signal?: AbortSignal }> {
	return Object.freeze(readSignal(record(value, 'saved operation options', ['signal'], [])));
}

/** The retained save owner contains one canonical, privately branded definition; JSON parsing scratch is released here. */
export function admitPhotoLibrarySavedCommandV1(value: unknown, createId: () => string): AdmittedPhotoLibrarySavedCommandV1 {
	if (branded(commands, value)) return value as AdmittedPhotoLibrarySavedCommandV1;
	const typeField = Object.getOwnPropertyDescriptor(record(value, 'saved command', ['type', 'context', 'collectionId',
		'expectedDefinitionRevision', 'name', 'queryJson'], ['type']), 'type')!.value as unknown;
	const type = oneOf(typeField, ['create', 'update', 'delete'] as const, 'saved command type');
	const keys = type === 'create' ? ['type', 'context', 'name', 'queryJson']
		: type === 'update' ? ['type', 'context', 'collectionId', 'expectedDefinitionRevision', 'name', 'queryJson']
			: ['type', 'context', 'collectionId', 'expectedDefinitionRevision'];
	const input = record(value, 'saved command', keys), context = readPhotoLibrarySavedContextV1(field(input, 'context'));
	for (const revision of [context.catalogRevision, context.indexRevision, context.collectionStateRevision]) {
		if (revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Saved write revision cannot advance.');
	}
	if (type === 'create' ? context.collectionCount === LIMITS.maximumCollections : context.collectionCount === 0) {
		throw new RangeError('Saved command count cannot advance.');
	}
	const expectedDefinitionRevision = type === 'create' ? null : revision(field(input, 'expectedDefinitionRevision'));
	if (expectedDefinitionRevision === Number.MAX_SAFE_INTEGER) throw new RangeError('Saved definition revision cannot advance.');
	let definition: Readonly<PhotoSmartCollectionV1> | null = null, collectionId: string;
	if (type === 'delete') collectionId = id(field(input, 'collectionId'), 'saved command selection ID');
	else {
		const title = name(field(input, 'name'), 'saved collection name'), parsed = parseQueryJson(field(input, 'queryJson'));
		// Validate all query semantics before invoking even the private ID allocator.
		const preflight = admitPhotoSmartCollectionSaveV1({ schemaVersion: 1, kind: 'photo-smart-collection', catalogId: context.catalogId,
			id: type === 'create' ? 'preflight' : id(field(input, 'collectionId'), 'saved command selection ID'),
			revision: expectedDefinitionRevision ?? 0, name: title, query: parsed }, expectedDefinitionRevision);
		collectionId = type === 'create' ? id(createId(), 'new saved collection ID') : preflight.id;
		definition = type === 'create' ? admitPhotoSmartCollectionSaveV1({ ...preflight, id: collectionId }, null) : preflight;
	}
	return brand(commands, Object.freeze({ type, context, collectionId, expectedDefinitionRevision, definition }));
}

export function readPhotoLibrarySavedContextV1(value: unknown): PhotoLibrarySavedCollectionContextV1 {
	const input = record(value, 'saved collection context', ['catalogId', 'catalogRevision', 'indexRevision', 'collectionStateRevision', 'collectionCount']);
	return Object.freeze({ catalogId: id(field(input, 'catalogId'), 'saved context catalog ID'),
		catalogRevision: revision(field(input, 'catalogRevision')), indexRevision: revision(field(input, 'indexRevision')),
		collectionStateRevision: revision(field(input, 'collectionStateRevision')),
		collectionCount: integer(field(input, 'collectionCount'), 0, LIMITS.maximumCollections, 'saved collection count') });
}
export function assertAdmittedPhotoLibrarySavedCommandV1(value: unknown): asserts value is AdmittedPhotoLibrarySavedCommandV1 {
	if (!branded(commands, value)) throw new TypeError('Saved writes require their private admitted command.');
}
export function savedLibraryRevisionV1(value: unknown): number { return revision(value); }
export function parsePhotoLibrarySavedQueryJsonV1(value: unknown): unknown { return parseQueryJson(value); }
function parseQueryJson(value: unknown): unknown {
	if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > LIMITS.maximumQueryJsonBytes) {
		throw new RangeError('Saved query JSON exceeds its 512 KiB bound.');
	}
	return record(JSON.parse(value) as unknown, 'complete saved query', ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate']);
}
function optionalCursor(input: Readonly<Record<string, unknown>>): string | null {
	const value = Object.hasOwn(input, 'cursor') ? field(input, 'cursor') : null;
	if (value === null) return null;
	if (typeof value !== 'string') throw new TypeError('Saved cursor must be an opaque string or null.');
	return value;
}
function parseCursor(value: string): unknown {
	if (new TextEncoder().encode(value).byteLength > LIMITS.maximumCursorBytes) throw new RangeError('Saved cursor exceeds its 4 KiB bound.');
	return JSON.parse(value) as unknown;
}
function readSignal(input: Readonly<Record<string, unknown>>): Readonly<{ signal?: AbortSignal }> {
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal === undefined) return {};
	assertPhotoStackQuerySignalV1(signal); return { signal };
}
function revision(value: unknown): number {
	if (Object.is(value, -0)) throw new TypeError('Saved revisions require canonical nonnegative integers.');
	return integer(value, 0, Number.MAX_SAFE_INTEGER, 'saved collection revision');
}
function branded(set: WeakSet<object>, value: unknown): value is object { return value !== null && typeof value === 'object' && set.has(value); }
function brand<T extends object>(set: WeakSet<object>, value: T): T { set.add(value); return value; }
