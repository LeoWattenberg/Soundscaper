/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Fresh first-release persistence; pre-release databases remain untouched. */
export const FRAMESCAPER_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v1',
	opfsDirectoryName: 'framescaper-editor-v1-sources',
	opfsWorkerName: 'framescaper-editor-v1-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v1-lock:',
});
