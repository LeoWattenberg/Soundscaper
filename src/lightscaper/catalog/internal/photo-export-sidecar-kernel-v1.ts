/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV1OrV2 } from '../../../common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateThroughV3 } from '../../../common/editor/imaging/image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateThroughV4 } from '../../../common/editor/imaging/image-develop-state-v4.ts';
import { normalizeImageMetadataV1 } from '../../../common/editor/imaging/image-metadata-normalizer-v1.ts';
import { readExactSafeVisualText } from '../../../common/editor/safe-visual-text.ts';
import { capturePhotoDocumentEnvelopeV1 } from '../photo-document-envelope-v1.ts';
import { assertPhotoDocumentByteBudgetV1, canonicalPhotoDocumentJsonV1 } from '../photo-document-json-v1.ts';
import { normalizePhotoDocumentV1OrV2 } from '../photo-document-v2.ts';
import { normalizePhotoDocumentCurrentV1 } from '../photo-document-current-v1.ts';
import { normalizePhotoDocumentV3 } from '../photo-document-v3.ts';
import { normalizePhotoMetadataV1 } from '../photo-metadata.ts';
import type { PhotoExportSidecarBindingV1, PhotoExportSidecarV1 } from '../photo-export-sidecar-v1.ts';
import type { PhotoExportSidecarV2 } from '../photo-export-sidecar-v2.ts';
import type { PhotoExportSidecarCurrentV1, PhotoExportSidecarPhoto3CurrentV1 } from '../photo-export-sidecar-current-v1.ts';
import { field, id, integer, name, oneOf, record, utcTimestamp } from '../value-validation.ts';

type Profile = 'legacy1' | 'current2' | 'current4' | 'current';
type SidecarFor<Policy extends Profile> = Policy extends 'legacy1' ? PhotoExportSidecarV1 : Policy extends 'current2' ? PhotoExportSidecarV2
	: Policy extends 'current4' ? PhotoExportSidecarPhoto3CurrentV1 : PhotoExportSidecarCurrentV1;
const FIELDS = ['schemaFamily', 'schemaVersion', 'kind', 'photoSchemaVersion', 'binding', 'original', 'version', 'metadata', 'extractedMetadata'];

/** Policies are fixed owning profiles, never caller normalizers or schema projections. */
export function createPhotoExportSidecarForProfileV1<Policy extends Profile>(profile: Policy, value: unknown, binding: PhotoExportSidecarBindingV1): SidecarFor<Policy> {
	admitProfile(profile);
	const request = record(binding, 'photo sidecar request', ['catalogId', 'photoId', 'versionId', 'expectedRevision']);
	const catalogId = id(field(request, 'catalogId'), 'sidecar catalog ID'), photoId = id(field(request, 'photoId'), 'sidecar photo ID');
	const versionId = id(field(request, 'versionId'), 'sidecar version ID');
	const revision = integer(field(request, 'expectedRevision'), 0, Number.MAX_SAFE_INTEGER, 'sidecar expected revision');
	const input = capturePhotoDocumentEnvelopeV1(value);
	if (field(input, 'catalogId') !== catalogId || field(input, 'id') !== photoId || field(input, 'revision') !== revision) {
		throw new Error('Photo sidecar source identity or revision changed.');
	}
	const photo = profile === 'legacy1' ? normalizePhotoDocumentV1OrV2(input)
		: profile === 'current2' ? normalizePhotoDocumentV3(input) : normalizePhotoDocumentCurrentV1(input);
	if ((profile === 'current2' || profile === 'current4') && photo.schemaVersion !== 3) throw new RangeError('Sidecar2 requires a complete Photo3 source.');
	if (photo.catalogId !== catalogId || photo.id !== photoId || photo.revision !== revision) {
		throw new Error('Photo sidecar source identity or revision changed during admission.');
	}
	const version = photo.versions.find(candidate => candidate.id === versionId);
	if (!version) throw new ReferenceError('The selected photo sidecar version is missing.');
	return normalizePhotoExportSidecarForProfileV1(profile, { schemaFamily: 'lightscaper', schemaVersion: photo.schemaVersion === 3 ? 2 : 1, kind: 'photo-export-sidecar',
		photoSchemaVersion: photo.schemaVersion, binding: { catalogId, photoId, revision, activeVersionId: photo.activeVersionId },
		original: { fileName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength },
		version: { id: version.id, kind: version.kind, name: version.name, createdAt: version.createdAt, develop: version.develop },
		metadata: photo.metadata, extractedMetadata: photo.extractedMetadata });
}

export function normalizePhotoExportSidecarForProfileV1<Policy extends Profile>(profile: Policy, value: unknown): SidecarFor<Policy> {
	admitProfile(profile);
	if (profile === 'current') {
		if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Sidecar requires an own schema version.');
		const version = field(value as Readonly<Record<string, unknown>>, 'schemaVersion');
		if (version === 1) return normalizePhotoExportSidecarForProfileV1('legacy1', value) as SidecarFor<Policy>;
		if (version === 2) return normalizePhotoExportSidecarForProfileV1('current4', value) as SidecarFor<Policy>;
		throw new RangeError('Unsupported photo export sidecar identity or version.');
	}
	const input = record(value, 'photo export sidecar', FIELDS), schemaVersion = profile === 'legacy1' ? 1 : 2;
	if (field(input, 'schemaFamily') !== 'lightscaper' || field(input, 'schemaVersion') !== schemaVersion || field(input, 'kind') !== 'photo-export-sidecar') {
		throw new RangeError('Unsupported photo export sidecar identity or version.');
	}
	const photoSchemaVersion = integer(field(input, 'photoSchemaVersion'), profile === 'legacy1' ? 1 : 3, profile === 'legacy1' ? 2 : 3, 'sidecar photo schema version');
	const source = record(field(input, 'binding'), 'sidecar photo binding', ['catalogId', 'photoId', 'revision', 'activeVersionId']);
	const binding = Object.freeze({ catalogId: id(field(source, 'catalogId'), 'sidecar catalog ID'), photoId: id(field(source, 'photoId'), 'sidecar photo ID'),
		revision: integer(field(source, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'sidecar photo revision'), activeVersionId: id(field(source, 'activeVersionId'), 'sidecar active version ID') });
	const selected = record(field(input, 'version'), 'sidecar selected version', ['id', 'kind', 'name', 'createdAt', 'develop']);
	const develop = profile === 'legacy1' ? normalizeImageDevelopStateV1OrV2(field(selected, 'develop'))
		: profile === 'current2' ? normalizeImageDevelopStateThroughV3(field(selected, 'develop')) : normalizeImageDevelopStateThroughV4(field(selected, 'develop'));
	if (photoSchemaVersion === 1 && develop.processVersion !== 1) throw new RangeError('A Photo1 sidecar cannot contain a successor develop process.');
	const extracted = field(input, 'extractedMetadata');
	const result = Object.freeze({ schemaFamily: 'lightscaper' as const, schemaVersion, kind: 'photo-export-sidecar' as const,
		photoSchemaVersion, binding, original: original(field(input, 'original')),
		version: Object.freeze({ id: id(field(selected, 'id'), 'sidecar version ID'), kind: oneOf(field(selected, 'kind'), ['master', 'virtual-copy'] as const, 'sidecar version kind'),
			name: name(field(selected, 'name'), 'sidecar version name'), createdAt: utcTimestamp(field(selected, 'createdAt'), 'sidecar version creation time'), develop }),
		metadata: normalizePhotoMetadataV1(field(input, 'metadata')), extractedMetadata: extracted === null ? null : normalizeImageMetadataV1(extracted) });
	assertPhotoDocumentByteBudgetV1(canonicalPhotoDocumentJsonV1(result));
	// The fixed policy above proves both discriminants and the paired recipe owner.
	return result as SidecarFor<Policy>;
}

export function serializePhotoExportSidecarForProfileV1(profile: Profile, value: unknown): string {
	const text = canonicalPhotoDocumentJsonV1(normalizePhotoExportSidecarForProfileV1(profile, value));
	assertPhotoDocumentByteBudgetV1(text); return text;
}
export function parsePhotoExportSidecarForProfileV1<Policy extends Profile>(profile: Policy, value: string): SidecarFor<Policy> {
	if (typeof value !== 'string') throw new TypeError('Photo export sidecar requires JSON text.');
	assertPhotoDocumentByteBudgetV1(value); const decoded: unknown = JSON.parse(value);
	return normalizePhotoExportSidecarForProfileV1(profile, decoded);
}
function admitProfile(profile: Profile): void {
	if (profile !== 'legacy1' && profile !== 'current2' && profile !== 'current4' && profile !== 'current') throw new TypeError('Unsupported fixed sidecar profile.');
}
function original(value: unknown): PhotoExportSidecarV1['original'] {
	const input = record(value, 'sidecar original binding', ['fileName', 'contentSha256', 'byteLength']), contentSha256 = field(input, 'contentSha256');
	if (typeof contentSha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(contentSha256)) throw new TypeError('Sidecar original requires a lowercase SHA-256.');
	return Object.freeze({ fileName: readExactSafeVisualText(field(input, 'fileName'), 'sidecar original filename', 512, false),
		contentSha256, byteLength: integer(field(input, 'byteLength'), 1, Number.MAX_SAFE_INTEGER, 'sidecar original byte length') });
}
