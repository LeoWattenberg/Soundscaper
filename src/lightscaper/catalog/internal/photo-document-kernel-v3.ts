/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateThroughV4 } from '../../../common/editor/imaging/image-develop-state-v4.ts';
import type { PhotoDevelopWorkspaceCurrentV1 } from '../photo-develop-workspace-current-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS } from '../types.ts';
import { capturePhotoDocumentEnvelopeV1, normalizePhotoDocumentEnvelopeV1 } from '../photo-document-envelope-v1.ts';
import { assertPhotoDocumentByteBudgetV1, canonicalPhotoDocumentJsonV1 } from '../photo-document-json-v1.ts';
import { array, field, id, name, oneOf, record, unique, utcTimestamp } from '../value-validation.ts';

/** Fixed public owners supply their complete nested recipe/workspace policy.
 * The shared Photo3 envelope retains Original identity and storage semantics. */
export function normalizePhotoDocumentForPolicyV3<Develop extends ImageDevelopStateThroughV4, Workspace extends PhotoDevelopWorkspaceCurrentV1>(value: unknown,
	normalizeDevelop: (value: unknown) => Readonly<Develop>, normalizeWorkspace: (value: unknown) => Workspace) {
	const input = capturePhotoDocumentEnvelopeV1(value);
	if (field(input, 'schemaFamily') !== 'lightscaper' || field(input, 'schemaVersion') !== 3) throw new RangeError('Unsupported Photo3 document identity.');
	oneOf(field(input, 'kind'), ['photo'] as const, 'photo kind');
	const versions = Object.freeze(array(field(input, 'versions'), 'photo versions', 1, LIMITS.maximumVersions).map(candidate => {
		const version = record(candidate, 'photo version', ['id', 'kind', 'name', 'createdAt', 'develop', 'workspace'], ['id', 'kind', 'name', 'createdAt', 'develop']);
		const develop = normalizeDevelop(field(version, 'develop'));
		const workspace = Object.hasOwn(version, 'workspace') ? normalizeWorkspace(field(version, 'workspace')) : undefined;
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
