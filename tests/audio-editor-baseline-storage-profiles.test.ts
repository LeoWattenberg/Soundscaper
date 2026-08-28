/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from '../src/framescaper/editor-project-storage-profile.ts';
import { SOUNDSCAPER_PROJECT_STORAGE_PROFILE } from '../src/soundscaper/editor-project-storage-profile.ts';

test('the 1.0 baseline uses fresh product-isolated browser storage identities', () => {
	assert.deepEqual({ ...editorProjectStorageProfileNames(SOUNDSCAPER_PROJECT_STORAGE_PROFILE) }, {
		databaseName: 'kw-media-soundscaper-editor-v1',
		opfsDirectoryName: 'soundscaper-editor-v1-sources',
		opfsWorkerName: 'soundscaper-editor-v1-opfs-storage',
		projectLockPrefix: 'kw-media-soundscaper-editor-v1-lock:',
	});
	assert.deepEqual({ ...editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE) }, {
		databaseName: 'kw-media-framescaper-editor-v1',
		opfsDirectoryName: 'framescaper-editor-v1-sources',
		opfsWorkerName: 'framescaper-editor-v1-opfs-storage',
		projectLockPrefix: 'kw-media-framescaper-editor-v1-lock:',
	});
});
