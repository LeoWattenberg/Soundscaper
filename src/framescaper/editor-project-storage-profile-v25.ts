/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Dormant V25 storage is isolated and is not selected by the application route. */
export const FRAMESCAPER_V25_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v25',
	opfsDirectoryName: 'framescaper-editor-v25-sources',
	opfsWorkerName: 'framescaper-editor-v25-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v25-lock:',
});
