/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoCatalogRootV1 } from './catalog-root.ts';
import { normalizePhotoDocumentV1 } from './photo-document.ts';
import { assertPhotoDocumentByteBudgetV1 as assertByteBudget, canonicalPhotoDocumentJsonV1 as canonicalJson } from './photo-document-json-v1.ts';
import type { LightscaperDocumentV1, PhotoCatalogRootV1 } from './types.ts';
import { field, record, requireSchema } from './value-validation.ts';

const validatedCatalogRoots = new WeakSet<object>();

/** v1 starts a new product family; no audio/timeline or pre-release migration is inferred. */
export function validateLightscaperDocumentV1(value: unknown): LightscaperDocumentV1 {
	const identity = record(value, 'Lightscaper document', [
		'schemaFamily', 'schemaVersion', 'kind', 'id', 'name', 'catalogId', 'revision', 'photoCount',
		'folders', 'keywords', 'collections', 'original', 'metadata', 'folderId', 'collectionIds',
		'keywordIds', 'rating', 'flag', 'colorLabel', 'versions', 'activeVersionId', 'extractedMetadata',
	], ['schemaFamily', 'schemaVersion', 'kind']);
	requireSchema(identity);
	let normalized: LightscaperDocumentV1;
	switch (field(identity, 'kind')) {
		case 'photo-catalog': normalized = normalizePhotoCatalogRootV1(value); break;
		case 'photo': normalized = normalizePhotoDocumentV1(value); break;
		default: throw new RangeError('Unsupported Lightscaper document kind.');
	}
	assertByteBudget(canonicalJson(normalized));
	if (normalized.kind === 'photo-catalog') validatedCatalogRoots.add(normalized);
	return normalized;
}

/** Borrowers may reuse only a root that completed the owning document admission. */
export function readValidatedPhotoCatalogRootV1(value: unknown): PhotoCatalogRootV1 {
	if (value !== null && typeof value === 'object' && validatedCatalogRoots.has(value)) return value as PhotoCatalogRootV1;
	const root = validateLightscaperDocumentV1(value);
	if (root.kind !== 'photo-catalog') throw new TypeError('A catalog root document is required.');
	return root;
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
