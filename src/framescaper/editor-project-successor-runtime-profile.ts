/* SPDX-License-Identifier: AGPL-3.0-only */
import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';
import { createEditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { createEditorProjectRuntimeProfilePrerequisite } from '../common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_PROJECT_FEATURE_CAPABILITY_PROFILE } from './editor-project-feature-capabilities.ts';
import { FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE } from './editor-project-successor.ts';
/** Ordinary media caches use the common schema; canonical owner/link intent stays in the separate v2 database. */
export const FRAMESCAPER_SUCCESSOR_MEDIA_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v2-media', opfsDirectoryName: 'framescaper-editor-v2-media-sources',
	opfsWorkerName: 'framescaper-editor-v2-media-opfs-storage', projectLockPrefix: 'kw-media-framescaper-editor-v2-media-lock:',
});
export const FRAMESCAPER_SUCCESSOR_RUNTIME_PROFILE = createEditorProjectRuntimeProfile({
	prerequisite: createEditorProjectRuntimeProfilePrerequisite({ owner: 'framescaper', projectSchemaVersion: 2,
		storageProfile: FRAMESCAPER_SUCCESSOR_STORAGE_PROFILE, priorSchemaPolicy: 'reimport-required', futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1], attachedScapeFormatVersion: 1, desktopLibrarySchemaVersion: 2, desktopProjectSchemaVersion: 2,
		desktopDatabaseUserVersion: 2, desktopLibraryScope: ['Framescaper', 'project-library', 'v2'],
	}), capabilityProfile: FRAMESCAPER_PROJECT_FEATURE_CAPABILITY_PROFILE,
});
