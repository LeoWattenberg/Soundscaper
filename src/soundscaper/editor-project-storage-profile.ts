/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/** Fresh first-release persistence; pre-release databases remain untouched. */
export const SOUNDSCAPER_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-soundscaper-editor-v1',
	opfsDirectoryName: 'soundscaper-editor-v1-sources',
	opfsWorkerName: 'soundscaper-editor-v1-opfs-storage',
	projectLockPrefix: 'kw-media-soundscaper-editor-v1-lock:',
});
