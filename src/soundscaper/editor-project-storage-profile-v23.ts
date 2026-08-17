/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEditorProjectStorageProfile } from '../common/editor/storage/project-storage-profile.ts';

/**
 * V23 is an isolated pre-release Soundscaper persistence authority.
 *
 * Every namespace here is distinct from V21's. Isolation is the entire reason
 * this file exists per revision: reusing V21's database name would let a
 * pre-release V23 write into live V21 user data.
 */
export const SOUNDSCAPER_V23_PROJECT_STORAGE_PROFILE = createEditorProjectStorageProfile({
	databaseName: 'kw-media-soundscaper-editor-v23',
	opfsDirectoryName: 'soundscaper-editor-v23-sources',
	opfsWorkerName: 'soundscaper-editor-v23-opfs-storage',
	projectLockPrefix: 'kw-media-soundscaper-editor-v23-lock:',
});
