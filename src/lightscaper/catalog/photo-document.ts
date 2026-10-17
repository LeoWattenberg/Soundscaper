/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCatalogIndexSourceV1 } from './photo-catalog-index-source-v1.ts';

import { normalizePhotoDevelopV1 } from './develop-state.ts';
import { normalizePhotoDevelopWorkspaceV1 } from './photo-develop-workspace-v1.ts';
import { capturePhotoDocumentEnvelopeV1, normalizePhotoDocumentEnvelopeV1 } from './photo-document-envelope-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS, type PhotoCatalogRootV1, type PhotoDocumentV1, type PhotoVersionV1 } from './types.ts';
import { array, field, id, name, oneOf, record, requireSchema, unique, utcTimestamp } from './value-validation.ts';

export function normalizePhotoDocumentV1(value: unknown): PhotoDocumentV1 {
	const input = capturePhotoDocumentEnvelopeV1(value);
	requireSchema(input);
	oneOf(field(input, 'kind'), ['photo'] as const, 'photo kind');
	const versions = normalizeVersions(field(input, 'versions'));
	const { fields, activeVersionId } = normalizePhotoDocumentEnvelopeV1(input, versions);
	return Object.freeze({
		schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo',
		...fields,
		versions, activeVersionId,
	});
}

/** Run at the catalog transaction boundary, after independently reading one photo row. */
export function validatePhotoCatalogReferencesV1(photo: PhotoCatalogIndexSourceV1, root: PhotoCatalogRootV1): void {
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

function normalizeVersions(value: unknown): readonly PhotoVersionV1[] {
	const versions = array(value, 'photo versions', 1, LIMITS.maximumVersions).map((candidate) => {
		const input = record(candidate, 'photo version', ['id', 'kind', 'name', 'createdAt', 'develop', 'workspace'], ['id', 'kind', 'name', 'createdAt', 'develop']);
		const develop = normalizePhotoDevelopV1(field(input, 'develop'));
		const workspace = Object.hasOwn(input, 'workspace') ? normalizePhotoDevelopWorkspaceV1(field(input, 'workspace')) : undefined;
		if (workspace && JSON.stringify(workspace.entries[workspace.cursor]!.develop) !== JSON.stringify(develop)) {
			throw new RangeError('Active develop settings must match the selected version history state.');
		}
		return Object.freeze({
			id: id(field(input, 'id'), 'photo version ID'),
			kind: oneOf(field(input, 'kind'), ['master', 'virtual-copy'] as const, 'photo version kind'),
			name: name(field(input, 'name'), 'photo version name'),
			createdAt: utcTimestamp(field(input, 'createdAt'), 'photo version creation time'),
			develop,
			...(workspace ? { workspace } : {}),
		});
	});
	unique(versions.map((version) => version.id), 'photo versions');
	if (versions.filter((version) => version.kind === 'master').length !== 1) throw new RangeError('Photo versions require exactly one master.');
	return Object.freeze(versions);
}
