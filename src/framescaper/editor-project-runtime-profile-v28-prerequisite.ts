/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfilePrerequisite } from '../common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_V28_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v28.ts';

export const FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'framescaper',
		projectSchemaVersion: 28,
		storageProfile: FRAMESCAPER_V28_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 19,
		desktopProjectSchemaVersion: 28,
		desktopDatabaseUserVersion: 21,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v19'],
	});
