/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Selected timeline-image storage is isolated from V28 and dormant V25/V26. */
export const FRAMESCAPER_V30_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v30',
	opfsDirectoryName: 'framescaper-editor-v30-sources',
	opfsWorkerName: 'framescaper-editor-v30-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v30-lock:',
});
