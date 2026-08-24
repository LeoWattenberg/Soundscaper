/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Selected M5 Framescaper storage is isolated from V27 and dormant V25/V26. */
export const FRAMESCAPER_V28_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v28',
	opfsDirectoryName: 'framescaper-editor-v28-sources',
	opfsWorkerName: 'framescaper-editor-v28-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v28-lock:',
});
