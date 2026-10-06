/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('native waveform stem eligibility stays with its timeline renderer', () => {
	for (const path of [
		'src/common/editor/audacity-waveform-renderer.js',
		'src/common/editor/waveform-stem-batch-capability.ts',
	]) {
		assert.equal(chunkGroupForModulePath(path), 'editor-timeline', path);
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', '\\')), 'editor-timeline', path);
	}
});
