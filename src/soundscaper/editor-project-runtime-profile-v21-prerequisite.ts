/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfilePrerequisite } from '../common/editor/project-runtime-profile-prerequisite.ts';
import { SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v21.ts';

export const SOUNDSCAPER_V21_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'soundscaper',
		projectSchemaVersion: 21,
		storageProfile: SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 10,
		desktopProjectSchemaVersion: 21,
		desktopDatabaseUserVersion: 12,
		desktopLibraryScope: ['kw.media', 'soundscaper-project-library', 'v10'],
	});
