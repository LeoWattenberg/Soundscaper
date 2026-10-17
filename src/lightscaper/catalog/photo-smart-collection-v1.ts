/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoCatalogQueryV2, PHOTO_QUERY_LIMITS_V2, type PhotoCatalogQueryV2 } from './photo-query-types-v2.ts';
import { field, id, integer, name, record } from './value-validation.ts';

export const PHOTO_SMART_COLLECTION_LIMITS_V1 = Object.freeze({ maximumDocumentBytes: PHOTO_QUERY_LIMITS_V2.maximumQueryBytes + 4096,
	maximumSummaryBytes: 4096, maximumCollections: 10_000 });

/** Independent saved-query authority; root/photo family-v1 documents remain unchanged. */
export interface PhotoSmartCollectionV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-smart-collection';
	readonly catalogId: string;
	readonly id: string;
	readonly revision: number;
	readonly name: string;
	readonly query: PhotoCatalogQueryV2;
}
export interface PhotoSmartCollectionSummaryV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-smart-collection-summary';
	readonly catalogId: string;
	readonly id: string;
	readonly revision: number;
	readonly name: string;
}

export function normalizePhotoSmartCollectionV1(value: unknown): Readonly<PhotoSmartCollectionV1> {
	const input = record(value, 'photo smart collection', ['schemaVersion', 'kind', 'catalogId', 'id', 'revision', 'name', 'query']);
	requireVersion(input, 'photo-smart-collection');
	const query = field(input, 'query');
	if (query === undefined) throw new TypeError('Photo smart collection requires an explicit saved query.');
	const result: PhotoSmartCollectionV1 = Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection',
		...identity(input), query: normalizePhotoCatalogQueryV2(query) });
	checkBudget(result, PHOTO_SMART_COLLECTION_LIMITS_V1.maximumDocumentBytes);
	return result;
}

export function serializePhotoSmartCollectionV1(value: unknown): string {
	return JSON.stringify(normalizePhotoSmartCollectionV1(value));
}

/** One scalar summary for a bounded page; the full predicate remains in its one owning document. */
export function photoSmartCollectionSummaryV1(value: unknown): Readonly<PhotoSmartCollectionSummaryV1> {
	const document = normalizePhotoSmartCollectionV1(value);
	return readPhotoSmartCollectionSummaryV1({ schemaVersion: 1, kind: 'photo-smart-collection-summary',
		catalogId: document.catalogId, id: document.id, revision: document.revision, name: document.name });
}

export function readPhotoSmartCollectionSummaryV1(value: unknown): Readonly<PhotoSmartCollectionSummaryV1> {
	const input = record(value, 'photo smart collection summary', ['schemaVersion', 'kind', 'catalogId', 'id', 'revision', 'name']);
	requireVersion(input, 'photo-smart-collection-summary');
	const result: PhotoSmartCollectionSummaryV1 = Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-summary', ...identity(input) });
	checkBudget(result, PHOTO_SMART_COLLECTION_LIMITS_V1.maximumSummaryBytes);
	return result;
}

function identity(input: Readonly<Record<string, unknown>>) {
	return { catalogId: id(field(input, 'catalogId'), 'smart collection catalog ID'), id: id(field(input, 'id'), 'smart collection ID'),
		revision: integer(field(input, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'smart collection revision'),
		name: name(field(input, 'name'), 'smart collection name') };
}

function requireVersion(input: Readonly<Record<string, unknown>>, kind: string): void {
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future photo smart collection version.');
	if (field(input, 'kind') !== kind) throw new TypeError('Unexpected photo smart collection document kind.');
}

function checkBudget(value: PhotoSmartCollectionV1 | PhotoSmartCollectionSummaryV1, maximum: number): void {
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maximum) {
		throw new RangeError('Photo smart collection exceeds its serialized byte budget.');
	}
}
