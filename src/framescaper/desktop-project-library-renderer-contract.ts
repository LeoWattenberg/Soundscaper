/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, PROJECT_SCHEMA_VERSION } from
	'../common/editor/project-schema-identity.ts';
import { editorProjectStorageProfileNames } from
	'../common/editor/storage/project-storage-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts';

export const FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE = Object.freeze({
	kind: 'framescaper-project-library-handshake' as const,
	version: 1 as const,
	owner: 'framescaper' as const,
	schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	schemaVersion: PROJECT_SCHEMA_VERSION,
	scapeFormatVersions: Object.freeze([1] as const),
	attachedScapeFormatVersion: 1 as const,
	storageDatabaseName: editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE).databaseName,
	desktopLibrarySchemaVersion: 1 as const,
	desktopDatabaseUserVersion: 1 as const,
	desktopLibraryScope: Object.freeze(['kw.media', 'framescaper-project-library', 'v1'] as const),
});
