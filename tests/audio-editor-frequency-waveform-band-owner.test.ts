/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

test('band pyramid generation belongs to the deferred frequency waveform chunk', () => {
	for (const separator of ['/', '\\']) {
		const path = ['src', 'common', 'editor', 'frequency-waveform-band-peaks.ts'].join(separator);
		assert.equal(chunkGroupForModulePath(path), 'editor-frequency-waveform');
	}
});
