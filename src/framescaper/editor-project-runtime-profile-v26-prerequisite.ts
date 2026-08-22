/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectRuntimeProfilePrerequisite,
} from '../common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_V26_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v26.ts';

export const FRAMESCAPER_V26_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'framescaper',
		projectSchemaVersion: 26,
		storageProfile: FRAMESCAPER_V26_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 16,
		desktopProjectSchemaVersion: 26,
		desktopDatabaseUserVersion: 18,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v16'],
	});
