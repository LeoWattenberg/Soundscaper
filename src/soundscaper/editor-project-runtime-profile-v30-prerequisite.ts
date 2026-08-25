/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfilePrerequisite } from '../common/editor/project-runtime-profile-prerequisite.ts';
import { SOUNDSCAPER_V30_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v30.ts';

/** V30 keeps the selected V29 desktop library and moves only document authority. */
export const SOUNDSCAPER_V30_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'soundscaper',
		projectSchemaVersion: 30,
		storageProfile: SOUNDSCAPER_V30_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 11,
		desktopProjectSchemaVersion: 30,
		desktopDatabaseUserVersion: 13,
		desktopLibraryScope: ['kw.media', 'soundscaper-project-library', 'v11'],
	});
