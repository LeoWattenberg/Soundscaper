/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Selected V20 storage remains isolated from every other project generation. */
export const FRAMESCAPER_V20_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v20',
	opfsDirectoryName: 'framescaper-editor-v20-sources',
	opfsWorkerName: 'framescaper-editor-v20-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v20-lock:',
});
