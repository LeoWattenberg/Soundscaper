/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

export const MOTIONSCAPER_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-motionscaper-editor-v1',
	opfsDirectoryName: 'motionscaper-editor-v1-sources',
	opfsWorkerName: 'motionscaper-editor-v1-opfs-storage',
	projectLockPrefix: 'kw-media-motionscaper-editor-v1-lock:',
});
