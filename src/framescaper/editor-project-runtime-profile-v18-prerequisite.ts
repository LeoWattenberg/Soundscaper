/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectRuntimeProfilePrerequisite,
} from '../common/editor/project-runtime-profile-prerequisite.ts';
import {
	FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
} from './editor-project-storage-profile-v18.ts';

export const FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'framescaper',
		projectSchemaVersion: 18,
		storageProfile: FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 10,
		desktopProjectSchemaVersion: 18,
		desktopDatabaseUserVersion: 12,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v10'],
	});
