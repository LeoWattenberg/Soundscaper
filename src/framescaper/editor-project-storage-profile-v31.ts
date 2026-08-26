/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Prepared F31 storage remains isolated until its route is explicitly selected. */
export const FRAMESCAPER_V31_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-framescaper-editor-v31',
	opfsDirectoryName: 'framescaper-editor-v31-sources',
	opfsWorkerName: 'framescaper-editor-v31-opfs-storage',
	projectLockPrefix: 'kw-media-framescaper-editor-v31-lock:',
});
