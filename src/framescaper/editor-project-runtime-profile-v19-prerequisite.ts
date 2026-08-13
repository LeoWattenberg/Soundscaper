/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectRuntimeProfilePrerequisite,
} from '../common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_V19_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v19.ts';

export const FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'framescaper',
		projectSchemaVersion: 19,
		storageProfile: FRAMESCAPER_V19_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 11,
		desktopProjectSchemaVersion: 19,
		desktopDatabaseUserVersion: 13,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v11'],
	});
