/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfilePrerequisite } from '../common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v31.ts';

export const FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'framescaper',
		projectSchemaVersion: 31,
		storageProfile: FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 20,
		desktopProjectSchemaVersion: 31,
		desktopDatabaseUserVersion: 22,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v20'],
	});
