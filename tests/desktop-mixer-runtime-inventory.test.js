/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DESKTOP_MIXER_RUNTIME_FILES } from '../scripts/lib/desktop-mixer-runtime-files.mjs';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';

test('the desktop mixer runtime inventory owns every staged mixer graph authority', () => {
	assert.deepEqual(DESKTOP_MIXER_RUNTIME_FILES, [
		'src/common/editor/folder-mixer-graph-v21.js',
		'src/common/editor/mixer-graph-v21.js',
		'src/common/editor/mixer-signal-edge-v21.js',
		'src/common/editor/mixer-signal-topology-v21.js',
	]);
	assert.deepEqual(
		DESKTOP_EXPECTED_RUNTIME_FILES.filter((file) => /\/(?:folder-)?mixer(?:-|\.)/u.test(file)),
		DESKTOP_MIXER_RUNTIME_FILES,
	);
});
