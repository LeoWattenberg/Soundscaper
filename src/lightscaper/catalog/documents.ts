/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoCatalogRootV1 } from './catalog-root.ts';
import { normalizePhotoDocumentV1 } from './photo-document.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type LightscaperDocumentV1 } from './types.ts';
import { field, record, requireSchema } from './value-validation.ts';

/** v1 starts a new product family; no audio/timeline or pre-release migration is inferred. */
export function validateLightscaperDocumentV1(value: unknown): LightscaperDocumentV1 {
	const identity = record(value, 'Lightscaper document', [
		'schemaFamily', 'schemaVersion', 'kind', 'id', 'name', 'catalogId', 'revision', 'photoCount',
		'folders', 'keywords', 'collections', 'original', 'metadata', 'folderId', 'collectionIds',
		'keywordIds', 'rating', 'flag', 'colorLabel', 'versions', 'activeVersionId',
	], ['schemaFamily', 'schemaVersion', 'kind']);
	requireSchema(identity);
	let normalized: LightscaperDocumentV1;
	switch (field(identity, 'kind')) {
		case 'photo-catalog': normalized = normalizePhotoCatalogRootV1(value); break;
		case 'photo': normalized = normalizePhotoDocumentV1(value); break;
		default: throw new RangeError('Unsupported Lightscaper document kind.');
	}
	assertByteBudget(canonicalJson(normalized));
	return normalized;
}

export function migrateLightscaperDocumentV1(value: unknown): LightscaperDocumentV1 {
	// The first supported successor must migrate this v1. No earlier identity is supported.
	return validateLightscaperDocumentV1(value);
}

export function cloneLightscaperDocumentV1(value: unknown): LightscaperDocumentV1 {
	return validateLightscaperDocumentV1(value);
}

export function serializeLightscaperDocumentV1(value: unknown): string {
	return canonicalJson(validateLightscaperDocumentV1(value));
}

export function parseLightscaperDocumentV1(value: string): LightscaperDocumentV1 {
	if (typeof value !== 'string') throw new TypeError('Lightscaper document requires JSON text.');
	assertByteBudget(value);
	const parsed: unknown = JSON.parse(value);
	return migrateLightscaperDocumentV1(parsed);
}

function assertByteBudget(value: string): void {
	if (value.length > LIMITS.maximumDocumentBytes || new TextEncoder().encode(value).byteLength > LIMITS.maximumDocumentBytes) {
		throw new RangeError('Lightscaper document exceeds its byte budget.');
	}
}

/** Called only on normalized inert data. Object keys sort by codepoint, never locale. */
function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		const record = value as Readonly<Record<string, unknown>>;
		return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}
