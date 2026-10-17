/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoSmartCollectionV1, PHOTO_SMART_COLLECTION_LIMITS_V1, type PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import { PHOTO_SMART_QUERY_LIMITS_V2, type PhotoPredicateV2 } from './photo-smart-query-types-v2.ts';
import { array, compareText, field, id, oneOf, record } from './value-validation.ts';

// ASCII identities are <=128 units. Each nested tuple string plus comma is <=288 bytes;
// the document bound, <=257 reference strings and <=1024 wrapper/key bytes are charged separately.
export const PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1 = Object.freeze({ maximumReferenceKeys: PHOTO_SMART_QUERY_LIMITS_V2.maximumNodes + 1,
	maximumBytes: PHOTO_SMART_COLLECTION_LIMITS_V1.maximumDocumentBytes + (PHOTO_SMART_QUERY_LIMITS_V2.maximumNodes + 1) * 288 + 1024 });
export interface PhotoSmartCollectionRecordV1 {
	readonly key: string;
	readonly catalogId: string;
	readonly referenceKeys: readonly string[];
	readonly document: Readonly<PhotoSmartCollectionV1>;
}
export function photoSmartCollectionKeyV1(catalogId: string, collectionId: string): string {
	return JSON.stringify([id(catalogId, 'smart collection catalog ID'), id(collectionId, 'smart collection ID')]);
}

/** The collection tag refers only to root1 collections, never to another companion definition. */
export function photoSmartCollectionReferenceKeyV1(catalogId: string, kind: 'folder' | 'keyword' | 'collection', referenceId: string): string {
	return JSON.stringify([id(catalogId, 'reference catalog ID'), oneOf(kind, ['folder', 'keyword', 'collection'] as const, 'reference kind'),
		id(referenceId, 'query reference ID')]);
}

export function photoSmartCollectionRecordV1(value: unknown): Readonly<PhotoSmartCollectionRecordV1> {
	const document = normalizePhotoSmartCollectionV1(value);
	const result = Object.freeze({ key: photoSmartCollectionKeyV1(document.catalogId, document.id),
		catalogId: document.catalogId, referenceKeys: references(document), document });
	checkBudget(result);
	return result;
}

/** Authenticate persisted projections, refusing corruption rather than repairing it during reads. */
export function readPhotoSmartCollectionRecordV1(value: unknown, catalogId: string, key: IDBValidKey): Readonly<PhotoSmartCollectionV1> {
	const catalog = id(catalogId, 'lookup catalog ID');
	const input = record(value, 'stored photo smart collection', ['key', 'catalogId', 'referenceKeys', 'document']);
	const document = normalizePhotoSmartCollectionV1(field(input, 'document'));
	const expectedKey = photoSmartCollectionKeyV1(catalog, document.id);
	if (document.catalogId !== catalog || field(input, 'catalogId') !== catalog || field(input, 'key') !== key || key !== expectedKey) {
		throw new TypeError('Stored smart collection identity disagrees with its lookup key.');
	}
	const stored = array(field(input, 'referenceKeys'), 'stored smart collection references', 0,
		PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumReferenceKeys);
	const referenceKeys = references(document);
	if (stored.length !== referenceKeys.length || stored.some((entry, index) => entry !== referenceKeys[index])) {
		throw new TypeError('Stored smart collection reference projection disagrees with its query.');
	}
	checkBudget({ key: expectedKey, catalogId: catalog, referenceKeys, document });
	return document;
}

function references(document: PhotoSmartCollectionV1): readonly string[] {
	const keys = new Set<string>();
	function add(kind: 'folder' | 'keyword' | 'collection', referenceId: string): void {
		keys.add(photoSmartCollectionReferenceKeyV1(document.catalogId, kind, referenceId));
	}
	function visit(predicate: PhotoPredicateV2): void {
		switch (predicate.kind) {
			case 'all':
			case 'any': for (const term of predicate.terms) visit(term); break;
			case 'not': visit(predicate.term); break;
			case 'folder':
			case 'keyword': add(predicate.kind, predicate.id); break;
		}
	}
	const filter = document.query.filter;
	if (filter?.kind === 'folder' || filter?.kind === 'keyword' || filter?.kind === 'collection') add(filter.kind, filter.id);
	if (document.query.predicate !== null) visit(document.query.predicate);
	return Object.freeze([...keys].sort(compareText));
}

function checkBudget(value: PhotoSmartCollectionRecordV1): void {
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > PHOTO_SMART_COLLECTION_RECORD_LIMITS_V1.maximumBytes) {
		throw new RangeError('Stored smart collection exceeds its serialized byte budget.');
	}
}
