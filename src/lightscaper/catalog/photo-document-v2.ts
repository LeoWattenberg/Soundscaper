/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV1OrV2, type ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import type { ImageDevelopStateV1 } from '../../common/editor/imaging/image-develop-contract-v1.ts';
import { normalizePhotoDevelopWorkspaceV1OrV2, type PhotoDevelopWorkspaceV2 } from './photo-develop-workspace-v2.ts';
import type { PhotoDevelopWorkspaceV1 } from './photo-develop-workspace-v1.ts';
import { capturePhotoDocumentEnvelopeV1, normalizePhotoDocumentEnvelopeV1 } from './photo-document-envelope-v1.ts';
import { assertPhotoDocumentByteBudgetV1, canonicalPhotoDocumentJsonV1 } from './photo-document-json-v1.ts';
import { normalizePhotoDocumentV1 } from './photo-document.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type PhotoDocumentV1, type PhotoVersionV1 } from './types.ts';
import { array, field, id, name, oneOf, record, unique, utcTimestamp } from './value-validation.ts';

export interface PhotoVersionV2 extends Omit<PhotoVersionV1, 'develop' | 'workspace'> {
	readonly develop: ImageDevelopStateV1 | ImageDevelopStateV2;
	readonly workspace?: PhotoDevelopWorkspaceV1 | PhotoDevelopWorkspaceV2;
}
/** Catalog roots remain V1; each successor photo opts into resource recipes. */
export interface PhotoDocumentV2 extends Omit<PhotoDocumentV1, 'schemaVersion' | 'versions'> {
	readonly schemaVersion: 2;
	readonly versions: readonly PhotoVersionV2[];
}

export function normalizePhotoDocumentV2(value: unknown): PhotoDocumentV2 {
	const input = capturePhotoDocumentEnvelopeV1(value);
	if (field(input, 'schemaFamily') !== 'lightscaper' || field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported Photo2 document identity.');
	oneOf(field(input, 'kind'), ['photo'] as const, 'photo kind');
	const versions = normalizeVersions(field(input, 'versions'));
	const { fields, activeVersionId } = normalizePhotoDocumentEnvelopeV1(input, versions);
	const result = Object.freeze({ schemaFamily: 'lightscaper' as const, schemaVersion: 2 as const, kind: 'photo' as const,
		...fields, versions, activeVersionId });
	assertPhotoDocumentByteBudgetV1(canonicalPhotoDocumentJsonV1(result));
	return result;
}

export function normalizePhotoDocumentV1OrV2(value: unknown): PhotoDocumentV1 | PhotoDocumentV2 {
	const input = capturePhotoDocumentEnvelopeV1(value);
	const version = field(input, 'schemaVersion');
	if (version === 1) {
		const photo = normalizePhotoDocumentV1(input);
		assertPhotoDocumentByteBudgetV1(canonicalPhotoDocumentJsonV1(photo));
		return photo;
	}
	if (version === 2) return normalizePhotoDocumentV2(input);
	throw new RangeError('Unsupported photo document version.');
}

/** Called only by an explicit successor edit; reading never migrates V1. */
export function upgradePhotoDocumentV2(value: unknown): PhotoDocumentV2 {
	const photo = normalizePhotoDocumentV1OrV2(value);
	return normalizePhotoDocumentV2({ ...photo, schemaVersion: 2 });
}

export function serializePhotoDocumentV1OrV2(value: unknown): string {
	const text = canonicalPhotoDocumentJsonV1(normalizePhotoDocumentV1OrV2(value));
	assertPhotoDocumentByteBudgetV1(text);
	return text;
}

export function parsePhotoDocumentV1OrV2(value: string): PhotoDocumentV1 | PhotoDocumentV2 {
	if (typeof value !== 'string') throw new TypeError('Photo document requires JSON text.');
	assertPhotoDocumentByteBudgetV1(value);
	const parsed: unknown = JSON.parse(value);
	return normalizePhotoDocumentV1OrV2(parsed);
}

function normalizeVersions(value: unknown): readonly PhotoVersionV2[] {
	const versions = array(value, 'photo versions', 1, LIMITS.maximumVersions).map(candidate => {
		const input = record(candidate, 'photo version', ['id', 'kind', 'name', 'createdAt', 'develop', 'workspace'], ['id', 'kind', 'name', 'createdAt', 'develop']);
		const develop = normalizeImageDevelopStateV1OrV2(field(input, 'develop'));
		const workspace = Object.hasOwn(input, 'workspace') ? normalizePhotoDevelopWorkspaceV1OrV2(field(input, 'workspace')) : undefined;
		if (workspace && JSON.stringify(workspace.entries[workspace.cursor]!.develop) !== JSON.stringify(develop)) {
			throw new RangeError('Active develop settings must match the selected version history state.');
		}
		return Object.freeze({ id: id(field(input, 'id'), 'photo version ID'),
			kind: oneOf(field(input, 'kind'), ['master', 'virtual-copy'] as const, 'photo version kind'),
			name: name(field(input, 'name'), 'photo version name'), createdAt: utcTimestamp(field(input, 'createdAt'), 'photo version creation time'),
			develop, ...(workspace ? { workspace } : {}) });
	});
	unique(versions.map(version => version.id), 'photo versions');
	if (versions.filter(version => version.kind === 'master').length !== 1) throw new RangeError('Photo versions require exactly one master.');
	return Object.freeze(versions);
}
