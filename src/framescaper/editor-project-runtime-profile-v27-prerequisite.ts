/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfilePrerequisite } from '../common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_V27_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v27.ts';

export const FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'framescaper',
		projectSchemaVersion: 27,
		storageProfile: FRAMESCAPER_V27_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 18,
		desktopProjectSchemaVersion: 27,
		desktopDatabaseUserVersion: 20,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v18'],
	});
