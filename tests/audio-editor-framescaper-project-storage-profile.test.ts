/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorProjectStorageProfileNames } from
	'../src/common/editor/storage/project-storage-profile.ts';
import { FRAMESCAPER_PROJECT_STORAGE_PROFILE } from
	'../src/framescaper/editor-project-storage-profile.ts';

test('Framescaper baseline owns only fresh v1 browser persistence names', () => {
	assert.deepEqual(editorProjectStorageProfileNames(FRAMESCAPER_PROJECT_STORAGE_PROFILE), {
		databaseName: 'kw-media-framescaper-editor-v1',
		opfsDirectoryName: 'framescaper-editor-v1-sources',
		opfsWorkerName: 'framescaper-editor-v1-opfs-storage',
		projectLockPrefix: 'kw-media-framescaper-editor-v1-lock:',
	});
});
