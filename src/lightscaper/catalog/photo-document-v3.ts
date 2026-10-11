/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateCurrentV1 } from '../../common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../../common/editor/imaging/image-develop-state-current-v1.ts';
import type { PhotoDocumentV1, PhotoVersionV1 } from './types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS } from './types.ts';
import { normalizePhotoDevelopWorkspaceCurrentV1, type PhotoDevelopWorkspaceCurrentV1 } from './photo-develop-workspace-current-v1.ts';
import { capturePhotoDocumentEnvelopeV1, normalizePhotoDocumentEnvelopeV1 } from './photo-document-envelope-v1.ts';
import { assertPhotoDocumentByteBudgetV1, canonicalPhotoDocumentJsonV1 } from './photo-document-json-v1.ts';
import { array, field, id, name, oneOf, record, unique, utcTimestamp } from './value-validation.ts';

export interface PhotoVersionV3 extends Omit<PhotoVersionV1, 'develop' | 'workspace'> {
	readonly develop: ImageDevelopStateCurrentV1;
	readonly workspace?: PhotoDevelopWorkspaceCurrentV1;
}
/** Explicit current scalar profile; roots, original identity and stores stay unchanged. */
export interface PhotoDocumentV3 extends Omit<PhotoDocumentV1, 'schemaVersion' | 'versions'> {
	readonly schemaVersion: 3;
	readonly versions: readonly PhotoVersionV3[];
}
export function normalizePhotoDocumentV3(value: unknown): PhotoDocumentV3 {
	const input = capturePhotoDocumentEnvelopeV1(value);
	if (field(input, 'schemaFamily') !== 'lightscaper' || field(input, 'schemaVersion') !== 3) throw new RangeError('Unsupported Photo3 document identity.');
	oneOf(field(input, 'kind'), ['photo'] as const, 'photo kind');
	const versions = Object.freeze(array(field(input, 'versions'), 'photo versions', 1, LIMITS.maximumVersions).map(candidate => {
		const version = record(candidate, 'photo version', ['id', 'kind', 'name', 'createdAt', 'develop', 'workspace'], ['id', 'kind', 'name', 'createdAt', 'develop']);
		const develop = normalizeImageDevelopStateCurrentV1(field(version, 'develop'));
		const workspace = Object.hasOwn(version, 'workspace') ? normalizePhotoDevelopWorkspaceCurrentV1(field(version, 'workspace')) : undefined;
		if (workspace && JSON.stringify(workspace.entries[workspace.cursor]!.develop) !== JSON.stringify(develop)) {
			throw new RangeError('Active develop settings must match the selected version history state.');
		}
		return Object.freeze({ id: id(field(version, 'id'), 'photo version ID'),
			kind: oneOf(field(version, 'kind'), ['master', 'virtual-copy'] as const, 'photo version kind'),
			name: name(field(version, 'name'), 'photo version name'), createdAt: utcTimestamp(field(version, 'createdAt'), 'photo version creation time'),
			develop, ...(workspace ? { workspace } : {}) });
	}));
	unique(versions.map(version => version.id), 'photo versions');
	if (versions.filter(version => version.kind === 'master').length !== 1) throw new RangeError('Photo versions require exactly one master.');
	const { fields, activeVersionId } = normalizePhotoDocumentEnvelopeV1(input, versions);
	const result = Object.freeze({ schemaFamily: 'lightscaper' as const, schemaVersion: 3 as const, kind: 'photo' as const, ...fields, versions, activeVersionId });
	assertPhotoDocumentByteBudgetV1(canonicalPhotoDocumentJsonV1(result));
	return result;
}
