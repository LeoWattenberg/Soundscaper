/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/**
 * V29 is an isolated pre-release Soundscaper persistence authority.
 *
 * Every namespace here is distinct from V21's. Isolation is the entire reason
 * this file exists per revision: reusing V21's database name would let a
 * pre-release V29 write into live V21 user data.
 */
export const SOUNDSCAPER_V29_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-soundscaper-editor-v29',
	opfsDirectoryName: 'soundscaper-editor-v29-sources',
	opfsWorkerName: 'soundscaper-editor-v29-opfs-storage',
	projectLockPrefix: 'kw-media-soundscaper-editor-v29-lock:',
});
