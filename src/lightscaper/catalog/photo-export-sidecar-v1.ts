/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV1 } from '../../common/editor/imaging/image-develop-contract-v1.ts';
import { normalizeImageDevelopStateV1OrV2, type ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import type { ImageMetadataV1 } from '../../common/editor/imaging/image-metadata-model-v1.ts';
import { normalizeImageMetadataV1 } from '../../common/editor/imaging/image-metadata-normalizer-v1.ts';
import { readExactSafeVisualText } from '../../common/editor/safe-visual-text.ts';
import { capturePhotoDocumentEnvelopeV1 } from './photo-document-envelope-v1.ts';
import { assertPhotoDocumentByteBudgetV1, canonicalPhotoDocumentJsonV1 } from './photo-document-json-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from './photo-document-v2.ts';
import { normalizePhotoMetadataV1 } from './photo-metadata.ts';
import type { PhotoMetadataV1 } from './types.ts';
import { field, id, integer, name, oneOf, record, utcTimestamp } from './value-validation.ts';

export interface PhotoExportSidecarBindingV1 {
	readonly catalogId: string;
	readonly photoId: string;
	readonly versionId: string;
	readonly expectedRevision: number;
}
export interface PhotoExportSidecarV1 {
	readonly schemaFamily: 'lightscaper';
	readonly schemaVersion: 1;
	readonly kind: 'photo-export-sidecar';
	readonly photoSchemaVersion: 1 | 2;
	readonly binding: Readonly<{ catalogId: string; photoId: string; revision: number; activeVersionId: string }>;
	readonly original: Readonly<{ fileName: string; contentSha256: string; byteLength: number }>;
	readonly version: Readonly<{ id: string; kind: 'master' | 'virtual-copy'; name: string; createdAt: string;
		develop: Readonly<ImageDevelopStateV1 | ImageDevelopStateV2> }>;
	readonly metadata: Readonly<PhotoMetadataV1>;
	readonly extractedMetadata: Readonly<ImageMetadataV1> | null;
}

export const PHOTO_EXPORT_SIDECAR_SUFFIX_V1 = '.lightscaper.json';
export const PHOTO_EXPORT_SIDECAR_MIME_TYPE_V1 = 'application/json';
const SIDECAR_FIELDS = ['schemaFamily', 'schemaVersion', 'kind', 'photoSchemaVersion', 'binding', 'original', 'version', 'metadata', 'extractedMetadata'];

/** A complete admitted Photo is the source, never a recipe/metadata pair from unrelated reads.
 * Scalar provenance binds the selected saved version; no locator, body or import authority is granted. */
export function createPhotoExportSidecarV1(value: unknown, binding: PhotoExportSidecarBindingV1): PhotoExportSidecarV1 {
	const request = record(binding, 'photo sidecar request', ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
	const catalogId = id(field(request, 'catalogId'), 'sidecar catalog ID'), photoId = id(field(request, 'photoId'), 'sidecar photo ID');
	const versionId = id(field(request, 'versionId'), 'sidecar version ID');
	const revision = integer(field(request, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'sidecar expected revision');
	const input = capturePhotoDocumentEnvelopeV1(value);
	if (field(input, 'catalogId') !== catalogId || field(input, 'id') !== photoId || field(input, 'revision') !== revision) {
		throw new Error('Photo sidecar source identity or revision changed.');
	}
	const photo = normalizePhotoDocumentV1OrV2(input);
	if (photo.catalogId !== catalogId || photo.id !== photoId || photo.revision !== revision) {
		throw new Error('Photo sidecar source identity or revision changed during admission.');
	}
	const version = photo.versions.find(candidate => candidate.id === versionId);
	if (!version) throw new ReferenceError('The selected photo sidecar version is missing.');
	return normalizePhotoExportSidecarV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-export-sidecar',
		photoSchemaVersion: photo.schemaVersion, binding: { catalogId, photoId, revision, activeVersionId: photo.activeVersionId },
		original: { fileName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength },
		version: { id: version.id, kind: version.kind, name: version.name, createdAt: version.createdAt, develop: version.develop },
		metadata: photo.metadata, extractedMetadata: photo.extractedMetadata });
}

/** Admit only this named sidecar schema; reading never upgrades a Photo or a develop process. */
export function normalizePhotoExportSidecarV1(value: unknown): PhotoExportSidecarV1 {
	const input = record(value, 'photo export sidecar', SIDECAR_FIELDS);
	if (field(input, 'schemaFamily') !== 'lightscaper' || field(input, 'schemaVersion') !== 1
		|| field(input, 'kind') !== 'photo-export-sidecar') throw new RangeError('Unsupported photo export sidecar identity or version.');
	const photoSchemaVersion = integer(field(input, 'photoSchemaVersion'), 1, 2, 'sidecar photo schema version') as 1 | 2;
	const source = record(field(input, 'binding'), 'sidecar photo binding', ['catalogId', 'photoId', 'revision', 'activeVersionId']);
	const binding = Object.freeze({ catalogId: id(field(source, 'catalogId'), 'sidecar catalog ID'), photoId: id(field(source, 'photoId'), 'sidecar photo ID'),
		revision: integer(field(source, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'sidecar photo revision'), activeVersionId: id(field(source, 'activeVersionId'), 'sidecar active version ID') });
	const selected = record(field(input, 'version'), 'sidecar selected version', ['id', 'kind', 'name', 'createdAt', 'develop']);
	const develop = normalizeImageDevelopStateV1OrV2(field(selected, 'develop'));
	if (photoSchemaVersion === 1 && develop.processVersion !== 1) throw new RangeError('A Photo1 sidecar cannot contain a successor develop process.');
	const extracted = field(input, 'extractedMetadata');
	const result = Object.freeze({ schemaFamily: 'lightscaper' as const, schemaVersion: 1 as const, kind: 'photo-export-sidecar' as const,
		photoSchemaVersion, binding, original: original(field(input, 'original')),
		version: Object.freeze({ id: id(field(selected, 'id'), 'sidecar version ID'),
			kind: oneOf(field(selected, 'kind'), ['master', 'virtual-copy'] as const, 'sidecar version kind'),
			name: name(field(selected, 'name'), 'sidecar version name'), createdAt: utcTimestamp(field(selected, 'createdAt'), 'sidecar version creation time'), develop }),
		metadata: normalizePhotoMetadataV1(field(input, 'metadata')), extractedMetadata: extracted === null ? null : normalizeImageMetadataV1(extracted) });
	assertPhotoDocumentByteBudgetV1(canonicalPhotoDocumentJsonV1(result));
	return result;
}

export function serializePhotoExportSidecarV1(value: unknown): string {
	const text = canonicalPhotoDocumentJsonV1(normalizePhotoExportSidecarV1(value));
	assertPhotoDocumentByteBudgetV1(text);
	return text;
}

export function parsePhotoExportSidecarV1(value: string): PhotoExportSidecarV1 {
	if (typeof value !== 'string') throw new TypeError('Photo export sidecar requires JSON text.');
	assertPhotoDocumentByteBudgetV1(value);
	const decoded: unknown = JSON.parse(value);
	return normalizePhotoExportSidecarV1(decoded);
}

function original(value: unknown): PhotoExportSidecarV1['original'] {
	const input = record(value, 'sidecar original binding', ['fileName', 'contentSha256', 'byteLength']), contentSha256 = field(input, 'contentSha256');
	if (typeof contentSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(contentSha256)) throw new TypeError('Sidecar original requires a lowercase SHA-256.');
	return Object.freeze({ fileName: readExactSafeVisualText(field(input, 'fileName'), 'sidecar original filename', 512, false),
		contentSha256, byteLength: integer(field(input, 'byteLength'), 1, Number.MAX_SAFE_INTEGER, 'sidecar original byte length') });
}
