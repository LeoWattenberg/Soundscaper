/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Dormant V24 storage identity. It is never routed by the selected product. */
export const FRAMESCAPER_V24_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v24',
	opfsDirectoryName: 'framescaper-editor-v24-sources',
	opfsWorkerName: 'framescaper-editor-v24-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v24-lock:',
});
