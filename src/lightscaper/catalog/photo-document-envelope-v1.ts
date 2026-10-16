/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClosedDomainRecord } from '../../common/editor/closed-domain-value.ts';
import { normalizeVideoStillSourceV1 } from '../../common/editor/video-visual-model-v24.ts';
import { readExactSafeVisualText } from '../../common/editor/safe-visual-text.ts';
import { normalizeImageMetadataV1 } from '../../common/editor/imaging/image-metadata-normalizer-v1.ts';
import { normalizePhotoMetadataV1 } from './photo-metadata.ts';
import { PHOTO_COLOR_LABELS, PHOTO_FLAGS } from './smart-query.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type PhotoDocumentV1, type PhotoOriginalV1 } from './types.ts';
import { field, id, integer, oneOf, record, uniqueIds } from './value-validation.ts';

const STILL_FIELDS = ['schemaVersion', 'kind', 'id', 'name', 'mimeType', 'storageKey', 'contentSha256', 'width', 'height', 'hasAlpha'];
const PHOTO_FIELDS = ['schemaFamily', 'schemaVersion', 'kind', 'id', 'catalogId', 'revision', 'original', 'metadata', 'folderId', 'collectionIds', 'keywordIds', 'rating', 'flag', 'colorLabel', 'versions', 'activeVersionId'];
type PhotoFieldsV1 = Omit<PhotoDocumentV1, 'schemaFamily' | 'schemaVersion' | 'kind' | 'versions' | 'activeVersionId'>;

/** Inert envelope capture only; version and develop admission stay with owners. */
export function capturePhotoDocumentEnvelopeV1(value: unknown): ClosedDomainRecord {
	return record(value, 'photo', [...PHOTO_FIELDS, 'extractedMetadata'], PHOTO_FIELDS);
}

/** Original, metadata and memberships keep their existing independent rules.
 * Actual admitted version IDs provide the active-version reference check. */
export function normalizePhotoDocumentEnvelopeV1(input: ClosedDomainRecord, versions: readonly Readonly<{ id: string }>[]):
	Readonly<{ fields: PhotoFieldsV1; activeVersionId: string }> {
	const activeVersionId = id(field(input, 'activeVersionId'), 'active photo version');
	if (!versions.some(version => version.id === activeVersionId)) throw new ReferenceError('The active photo version is missing.');
	const folder = field(input, 'folderId');
	const extracted = Object.hasOwn(input, 'extractedMetadata') ? field(input, 'extractedMetadata') : null;
	const fields = Object.freeze({
		id: id(field(input, 'id'), 'photo ID'),
		catalogId: id(field(input, 'catalogId'), 'photo catalog ID'),
		revision: integer(field(input, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'photo revision'),
		original: normalizeOriginal(field(input, 'original')),
		metadata: normalizePhotoMetadataV1(field(input, 'metadata')),
		extractedMetadata: extracted === null ? null : normalizeImageMetadataV1(extracted),
		folderId: folder === null ? null : id(folder, 'photo folder ID'),
		collectionIds: uniqueIds(field(input, 'collectionIds'), 'photo collections', LIMITS.maximumMemberships),
		keywordIds: uniqueIds(field(input, 'keywordIds'), 'photo keywords', LIMITS.maximumMemberships),
		rating: integer(field(input, 'rating'), 0, 5, 'photo rating'),
		flag: oneOf(field(input, 'flag'), PHOTO_FLAGS, 'photo flag'),
		colorLabel: oneOf(field(input, 'colorLabel'), PHOTO_COLOR_LABELS, 'photo color label'),
	});
	return Object.freeze({ fields, activeVersionId });
}

function normalizeOriginal(value: unknown): PhotoOriginalV1 {
	const input = record(value, 'photo original', [...STILL_FIELDS, 'byteLength', 'retention']);
	const still = Object.fromEntries(STILL_FIELDS.map(key => [key, field(input, key)]));
	const originalName = readExactSafeVisualText(field(input, 'name'), 'photo original filename', 512, false);
	return Object.freeze({
		...normalizeVideoStillSourceV1({ ...still, name: 'Photo' }),
		name: originalName,
		byteLength: integer(field(input, 'byteLength'), 1, Number.MAX_SAFE_INTEGER, 'original byte length'),
		retention: oneOf(field(input, 'retention'), ['managed', 'linked'] as const, 'original retention'),
	});
}

/** Shared immutable Original admission; the permanent envelope keeps the exact
 * same implementation, fields and bounds. */
export { normalizeOriginal as normalizePhotoOriginalV1 };
