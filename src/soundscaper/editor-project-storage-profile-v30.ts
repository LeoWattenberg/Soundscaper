/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Isolated persistence authority for the selected assistance-aware document. */
export const SOUNDSCAPER_V30_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-soundscaper-editor-v30',
	opfsDirectoryName: 'soundscaper-editor-v30-sources',
	opfsWorkerName: 'soundscaper-editor-v30-opfs-storage',
	projectLockPrefix: 'kw-media-soundscaper-editor-v30-lock:',
});
