/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectRuntimeProfilePrerequisite } from '../common/editor/project-runtime-profile-prerequisite.ts';
import { SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE } from './editor-project-storage-profile-v29.ts';

/**
 * The renderer and desktop schema numbers move together — the prerequisite
 * validator refuses unless they are equal, so bumping one alone fails at module
 * load, before any test runs.
 */
export const SOUNDSCAPER_V29_PROJECT_RUNTIME_PROFILE_PREREQUISITE =
	createEditorProjectRuntimeProfilePrerequisite({
		owner: 'soundscaper',
		projectSchemaVersion: 29,
		storageProfile: SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE,
		priorSchemaPolicy: 'reimport-required',
		futureSchemaPolicy: 'opaque-read-only',
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		desktopLibrarySchemaVersion: 11,
		desktopProjectSchemaVersion: 29,
		desktopDatabaseUserVersion: 13,
		desktopLibraryScope: ['kw.media', 'soundscaper-project-library', 'v11'],
	});
