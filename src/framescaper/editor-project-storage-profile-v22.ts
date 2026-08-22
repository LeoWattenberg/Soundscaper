/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Dormant V22 storage identity. It is never routed by the selected product. */
export const FRAMESCAPER_V22_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v22',
	opfsDirectoryName: 'framescaper-editor-v22-sources',
	opfsWorkerName: 'framescaper-editor-v22-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v22-lock:',
});
