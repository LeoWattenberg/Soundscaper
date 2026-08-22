/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Dormant V26 storage identity. No shipped product route opens this database. */
export const FRAMESCAPER_V26_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v26',
	opfsDirectoryName: 'framescaper-editor-v26-sources',
	opfsWorkerName: 'framescaper-editor-v26-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v26-lock:',
});
