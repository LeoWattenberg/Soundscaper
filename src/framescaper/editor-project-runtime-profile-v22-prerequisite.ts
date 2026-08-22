/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfilePrerequisite } from '../common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_V22_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v22.ts';

export const FRAMESCAPER_V22_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'framescaper',
		projectSchemaVersion: 22,
		storageProfile: FRAMESCAPER_V22_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 13,
		desktopProjectSchemaVersion: 22,
		desktopDatabaseUserVersion: 15,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v13'],
	});
