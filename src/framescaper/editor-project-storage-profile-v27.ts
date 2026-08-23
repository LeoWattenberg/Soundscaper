/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Selected V27 browser storage is physically isolated from every earlier generation. */
export const FRAMESCAPER_V27_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v27',
	opfsDirectoryName: 'framescaper-editor-v27-sources',
	opfsWorkerName: 'framescaper-editor-v27-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v27-lock:',
});
