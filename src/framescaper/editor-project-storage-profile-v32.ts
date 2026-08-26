/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Selected timeline-image storage is isolated from V28 and dormant V25/V26. */
export const FRAMESCAPER_V32_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v32',
	opfsDirectoryName: 'framescaper-editor-v32-sources',
	opfsWorkerName: 'framescaper-editor-v32-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v32-lock:',
});
