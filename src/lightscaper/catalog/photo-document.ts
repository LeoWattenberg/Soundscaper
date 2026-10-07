/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoStillSourceV1 } from '../../common/editor/video-visual-model-v24.ts';
import { normalizeImageMetadataV1 } from '../../common/editor/imaging/image-metadata-normalizer-v1.ts';
import { normalizePhotoDevelopV1 } from './develop-state.ts';
import { normalizePhotoMetadataV1 } from './photo-metadata.ts';
import { PHOTO_COLOR_LABELS, PHOTO_FLAGS } from './smart-query.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type PhotoCatalogRootV1, type PhotoDocumentV1, type PhotoOriginalV1, type PhotoVersionV1 } from './types.ts';
import { array, field, id, integer, name, oneOf, record, requireSchema, unique, uniqueIds, utcTimestamp } from './value-validation.ts';

const STILL_FIELDS = ['schemaVersion', 'kind', 'id', 'name', 'mimeType', 'storageKey', 'contentSha256', 'width', 'height', 'hasAlpha'];
const PHOTO_FIELDS = ['schemaFamily', 'schemaVersion', 'kind', 'id', 'catalogId', 'revision', 'original', 'metadata', 'folderId', 'collectionIds', 'keywordIds', 'rating', 'flag', 'colorLabel', 'versions', 'activeVersionId'];

export function normalizePhotoDocumentV1(value: unknown): PhotoDocumentV1 {
	const input = record(value, 'photo', [...PHOTO_FIELDS, 'extractedMetadata'], PHOTO_FIELDS);
	requireSchema(input);
	oneOf(field(input, 'kind'), ['photo'] as const, 'photo kind');
	const versions = normalizeVersions(field(input, 'versions'));
	const activeVersionId = id(field(input, 'activeVersionId'), 'active photo version');
	if (!versions.some((version) => version.id === activeVersionId)) throw new ReferenceError('The active photo version is missing.');
	const folder = field(input, 'folderId');
	const extracted = Object.hasOwn(input, 'extractedMetadata') ? field(input, 'extractedMetadata') : null;
	return Object.freeze({
		schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo',
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
		versions, activeVersionId,
	});
}

/** Run at the catalog transaction boundary, after independently reading one photo row. */
export function validatePhotoCatalogReferencesV1(photo: PhotoDocumentV1, root: PhotoCatalogRootV1): void {
	if (photo.catalogId !== root.id) throw new ReferenceError('Photo belongs to a different catalog.');
	const folders = new Set(root.folders.map((folder) => folder.id));
	const keywords = new Set(root.keywords.map((keyword) => keyword.id));
	const manualCollections = new Set(root.collections.filter((collection) => collection.kind === 'manual').map((collection) => collection.id));
	if (photo.folderId !== null && !folders.has(photo.folderId)) throw new ReferenceError('Photo references a missing virtual folder.');
	for (const keyword of photo.keywordIds) {
		if (!keywords.has(keyword)) throw new ReferenceError('Photo references a missing keyword.');
	}
	for (const collection of photo.collectionIds) {
		if (!manualCollections.has(collection)) throw new ReferenceError('Photo must reference an existing manual collection.');
	}
}

function normalizeOriginal(value: unknown): PhotoOriginalV1 {
	const input = record(value, 'photo original', [...STILL_FIELDS, 'byteLength', 'retention']);
	const still = Object.fromEntries(STILL_FIELDS.map((key) => [key, field(input, key)]));
	return Object.freeze({
		...normalizeVideoStillSourceV1(still),
		byteLength: integer(field(input, 'byteLength'), 1, Number.MAX_SAFE_INTEGER, 'original byte length'),
		retention: oneOf(field(input, 'retention'), ['managed', 'linked'] as const, 'original retention'),
	});
}

function normalizeVersions(value: unknown): readonly PhotoVersionV1[] {
	const versions = array(value, 'photo versions', 1, LIMITS.maximumVersions).map((candidate) => {
		const input = record(candidate, 'photo version', ['id', 'kind', 'name', 'createdAt', 'develop']);
		return Object.freeze({
			id: id(field(input, 'id'), 'photo version ID'),
			kind: oneOf(field(input, 'kind'), ['master', 'virtual-copy'] as const, 'photo version kind'),
			name: name(field(input, 'name'), 'photo version name'),
			createdAt: utcTimestamp(field(input, 'createdAt'), 'photo version creation time'),
			develop: normalizePhotoDevelopV1(field(input, 'develop')),
		});
	});
	unique(versions.map((version) => version.id), 'photo versions');
	if (versions.filter((version) => version.kind === 'master').length !== 1) throw new RangeError('Photo versions require exactly one master.');
	return Object.freeze(versions);
}
