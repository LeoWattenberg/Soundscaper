/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../closed-domain-value.ts';
import { PHOTO_LIBRARY_SAVED_COLLECTION_LIMITS_V1 as LIMITS,
	type PhotoLibrarySavedCollectionCommandV1, type PhotoLibrarySavedCollectionContextV1 } from '../../photo-library-saved-collection-port-v1.ts';

/** Detach scalar authoring intent before borrowed acquisition; the product owns full query semantics. */
export function detachPhotoLibrarySavedCommandV1(value: unknown): PhotoLibrarySavedCollectionCommandV1 {
	const candidate = record(value, 'saved filter command', ['type', 'context', 'collectionId', 'expectedDefinitionRevision', 'name', 'queryJson'], ['type']);
	const type = read(candidate, 'type');
	if (type !== 'create' && type !== 'update' && type !== 'delete') throw new TypeError('Saved filter command type is unsupported.');
	const keys = type === 'create' ? ['type', 'context', 'name', 'queryJson'] : type === 'update'
		? ['type', 'context', 'collectionId', 'expectedDefinitionRevision', 'name', 'queryJson']
		: ['type', 'context', 'collectionId', 'expectedDefinitionRevision'];
	const input = record(value, 'saved filter command', keys), context = detachContext(read(input, 'context'));
	if (type === 'delete') return Object.freeze({ type, context, collectionId: id(read(input, 'collectionId')),
		expectedDefinitionRevision: revision(read(input, 'expectedDefinitionRevision')) });
	const name = read(input, 'name'), queryJson = read(input, 'queryJson');
	if (typeof name !== 'string' || !name.trim() || name.length > 256 || /[\p{Cc}\p{Cf}]/u.test(name)) {
		throw new TypeError('Saved filter name requires bounded safe text.');
	}
	if (typeof queryJson !== 'string' || new TextEncoder().encode(queryJson).byteLength > LIMITS.maximumQueryJsonBytes) {
		throw new RangeError('Saved filter recipe exceeds its 512 KiB bound.');
	}
	if (type === 'create') return Object.freeze({ type, context, name, queryJson });
	return Object.freeze({ type, context, collectionId: id(read(input, 'collectionId')),
		expectedDefinitionRevision: revision(read(input, 'expectedDefinitionRevision')), name, queryJson });
}
function detachContext(value: unknown): PhotoLibrarySavedCollectionContextV1 {
	const input = record(value, 'saved filter context', ['catalogId', 'catalogRevision', 'indexRevision', 'collectionStateRevision', 'collectionCount']);
	const collectionCount = revision(read(input, 'collectionCount'));
	if (collectionCount > LIMITS.maximumCollections) throw new RangeError('Saved filter count exceeds its bound.');
	return Object.freeze({ catalogId: id(read(input, 'catalogId')), catalogRevision: revision(read(input, 'catalogRevision')),
		indexRevision: revision(read(input, 'indexRevision')), collectionStateRevision: revision(read(input, 'collectionStateRevision')), collectionCount });
}
function read(value: Readonly<Record<string, unknown>>, key: string): unknown { return field(value, key, 'saved filter'); }
function id(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Saved filter requires a stable ID.');
	return value;
}
function revision(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
		throw new TypeError('Saved filter revision requires a canonical nonnegative integer.');
	}
	return value;
}
