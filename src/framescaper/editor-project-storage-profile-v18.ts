/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

export const FRAMESCAPER_V18_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v18',
	opfsDirectoryName: 'framescaper-editor-v18-sources',
	opfsWorkerName: 'framescaper-editor-v18-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v18-lock:',
});
