/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** V21 is an isolated pre-release Soundscaper persistence authority. */
export const SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-soundscaper-editor-v21',
	opfsDirectoryName: 'soundscaper-editor-v21-sources',
	opfsWorkerName: 'soundscaper-editor-v21-opfs-storage',
	projectLockPrefix: 'kw-media-soundscaper-editor-v21-lock:',
});
