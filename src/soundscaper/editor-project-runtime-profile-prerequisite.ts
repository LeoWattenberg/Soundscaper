/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfilePrerequisite } from
	'../common/editor/project-runtime-profile-prerequisite.ts';
import { SOUNDSCAPER_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile.ts';

export const SOUNDSCAPER_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'soundscaper',
		projectSchemaVersion: 1,
		storageProfile: SOUNDSCAPER_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1],
		attachedScapeFormatVersion: 1,
		desktopLibrarySchemaVersion: 1,
		desktopProjectSchemaVersion: 1,
		desktopDatabaseUserVersion: 1,
		desktopLibraryScope: ['kw.media', 'soundscaper-project-library', 'v1'],
	});
