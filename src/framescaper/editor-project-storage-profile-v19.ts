/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** V19 starts a fresh pre-release persistence namespace; V18 remains immutable. */
export const FRAMESCAPER_V19_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v19',
	opfsDirectoryName: 'framescaper-editor-v19-sources',
	opfsWorkerName: 'framescaper-editor-v19-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v19-lock:',
});
