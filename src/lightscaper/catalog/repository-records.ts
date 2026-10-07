/* SPDX-License-Identifier: AGPL-3.0-only */

import { validateLightscaperDocumentV1 } from './documents.ts';
import { PHOTO_CATALOG_REPOSITORY_LIMITS as LIMITS, type PhotoCatalogFilterV1, type PhotoCatalogIndexStateV1, type PhotoMembershipV1, type PhotoSummaryV1 } from './repository-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoCatalogRootV1, type PhotoDocumentV1 } from './types.ts';
import { field, id, integer, localTimestamp, name, oneOf, record, requireSchema } from './value-validation.ts';
import { PHOTO_FLAGS, PHOTO_COLOR_LABELS } from './smart-query.ts';

export function photoStorageKey(catalogId: string, photoId: string): string {
	return `${id(catalogId, 'catalog ID')}|${id(photoId, 'photo ID')}`;
}

export function indexState(root: PhotoCatalogRootV1, indexRevision: number): PhotoCatalogIndexStateV1 {
	return Object.freeze({ id: root.id, schemaFamily: 'lightscaper', schemaVersion: 1,
		rootRevision: root.revision, photoCount: root.photoCount,
		indexRevision: integer(indexRevision, 0, Number.MAX_SAFE_INTEGER, 'catalog index revision') });
}

export function readIndexState(value: unknown): PhotoCatalogIndexStateV1 {
	const input = record(value, 'catalog index state', ['id', 'schemaFamily', 'schemaVersion', 'rootRevision', 'indexRevision', 'photoCount']);
	requireSchema(input);
	return Object.freeze({ id: id(field(input, 'id'), 'catalog state ID'), schemaFamily: 'lightscaper', schemaVersion: 1,
		rootRevision: integer(field(input, 'rootRevision'), 0, Number.MAX_SAFE_INTEGER, 'root revision'),
		indexRevision: integer(field(input, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'index revision'),
		photoCount: integer(field(input, 'photoCount'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos, 'catalog photo count') });
}

export function photoSummary(photo: PhotoDocumentV1): PhotoSummaryV1 {
	return readPhotoSummary({ key: photoStorageKey(photo.catalogId, photo.id), catalogId: photo.catalogId,
		photoId: photo.id, photoRevision: photo.revision, fileName: photo.metadata.fileName,
		captureLocal: photo.metadata.captureTime?.local ?? null, rating: photo.rating, flag: photo.flag,
		colorLabel: photo.colorLabel, folderId: photo.folderId, activeVersionId: photo.activeVersionId,
		originalSha256: photo.original.contentSha256, width: photo.original.width, height: photo.original.height });
}

export function readPhotoSummary(value: unknown): PhotoSummaryV1 {
	const input = record(value, 'photo summary', ['key', 'catalogId', 'photoId', 'photoRevision', 'fileName', 'captureLocal', 'rating', 'flag', 'colorLabel', 'folderId', 'activeVersionId', 'originalSha256', 'width', 'height']);
	const catalogId = id(field(input, 'catalogId'), 'summary catalog ID');
	const photoId = id(field(input, 'photoId'), 'summary photo ID');
	const key = photoStorageKey(catalogId, photoId);
	if (field(input, 'key') !== key) throw new TypeError('Photo summary key disagrees with its identity.');
	const digest = field(input, 'originalSha256');
	if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest)) throw new TypeError('Photo summary digest requires SHA-256.');
	const capture = field(input, 'captureLocal');
	const folder = field(input, 'folderId');
	const summary = Object.freeze({ key, catalogId, photoId,
		photoRevision: integer(field(input, 'photoRevision'), 0, Number.MAX_SAFE_INTEGER, 'summary photo revision'),
		fileName: name(field(input, 'fileName'), 'summary filename'),
		captureLocal: capture === null ? null : localTimestamp(capture, 'summary capture time'),
		rating: integer(field(input, 'rating'), 0, 5, 'summary rating'),
		flag: oneOf(field(input, 'flag'), PHOTO_FLAGS, 'summary flag'),
		colorLabel: oneOf(field(input, 'colorLabel'), PHOTO_COLOR_LABELS, 'summary color label'),
		folderId: folder === null ? null : id(folder, 'summary folder ID'),
		activeVersionId: id(field(input, 'activeVersionId'), 'summary active version'), originalSha256: digest,
		width: integer(field(input, 'width'), 1, 65_536, 'summary width'), height: integer(field(input, 'height'), 1, 65_536, 'summary height') });
	if (new TextEncoder().encode(JSON.stringify(summary)).byteLength > LIMITS.maximumSummaryBytes) throw new RangeError('Photo summary exceeds its byte budget.');
	return summary;
}

export function readStoredPhoto(value: unknown): PhotoDocumentV1 {
	const input = record(value, 'stored photo', ['key', 'document']);
	const photo = validateLightscaperDocumentV1(field(input, 'document'));
	if (photo.kind !== 'photo') throw new TypeError('Stored photo requires a photo document.');
	if (field(input, 'key') !== photoStorageKey(photo.catalogId, photo.id)) throw new TypeError('Stored photo key disagrees with its document.');
	return photo;
}

export function filterScope(catalogId: string, value?: PhotoCatalogFilterV1): string {
	const catalog = id(catalogId, 'catalog filter ID');
	if (value === undefined) return `${catalog}|all`;
	const input = record(value, 'catalog filter', ['kind', 'id', 'value'], ['kind']);
	const kind = oneOf(field(input, 'kind'), ['folder', 'keyword', 'collection', 'rating', 'flag', 'label'] as const, 'catalog filter kind');
	if (kind === 'folder' || kind === 'keyword' || kind === 'collection') {
		record(input, 'hierarchy catalog filter', ['kind', 'id']);
		return `${catalog}|${kind}|${id(field(input, 'id'), 'catalog filter node ID')}`;
	}
	record(input, 'value catalog filter', ['kind', 'value']);
	const candidate = field(input, 'value');
	const filter = kind === 'rating' ? String(integer(candidate, 0, 5, 'catalog filter rating'))
		: kind === 'flag' ? oneOf(candidate, PHOTO_FLAGS, 'catalog filter flag') : oneOf(candidate, PHOTO_COLOR_LABELS, 'catalog filter label');
	return `${catalog}|${kind}|${filter}`;
}

export function photoMemberships(photo: PhotoDocumentV1): readonly PhotoMembershipV1[] {
	const photoKey = photoStorageKey(photo.catalogId, photo.id);
	const filters: PhotoCatalogFilterV1[] = [
		{ kind: 'rating', value: photo.rating }, { kind: 'flag', value: photo.flag }, { kind: 'label', value: photo.colorLabel },
		...photo.keywordIds.map((id) => ({ kind: 'keyword' as const, id })),
		...photo.collectionIds.map((id) => ({ kind: 'collection' as const, id })),
	];
	if (photo.folderId !== null) filters.push({ kind: 'folder', id: photo.folderId });
	return Object.freeze(filters.map((filter) => {
		const scope = filterScope(photo.catalogId, filter);
		return Object.freeze({ key: `${scope}|${photo.id}`, scope, photoKey });
	}));
}
