/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createEditorProjectRuntimeProfilePrerequisite,
} from '../common/editor/project-runtime-profile-prerequisite.ts';
import { FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v20.ts';

export const FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'framescaper',
		projectSchemaVersion: 20,
		storageProfile: FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 12,
		desktopProjectSchemaVersion: 20,
		desktopDatabaseUserVersion: 14,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v12'],
	});
