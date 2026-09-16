/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('toast presentation and progress leaves belong to the ready editor shell', () => {
	for (const path of [
		'components/src/Toast/Toast.tsx',
		'components/src/ProgressBar/ProgressBar.tsx',
	]) assert.equal(chunkGroupForModulePath(`vendor/audacity-design-system/${path}`), 'editor-shell-design-components', path);
});

test('the project lock notification loads only when the lock warning applies', () => {
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/ProjectLockToast.tsx'), 'editor-optional-surfaces');
});
