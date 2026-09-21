/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePcmChunkFrames } from '../src/common/editor/storage/pcm-chunk-geometry.ts';
import { WAVPACK_PCM_MAXIMUM_FRAMES } from '../src/common/editor/wavpack/index.js';

test('PCM chunk geometry admits exactly the shared WavPack frame range', () => {
	assert.equal(normalizePcmChunkFrames(1), 1);
	assert.equal(normalizePcmChunkFrames(String(WAVPACK_PCM_MAXIMUM_FRAMES)), WAVPACK_PCM_MAXIMUM_FRAMES);
	for (const value of [0, -1, 1.5, Number.NaN, WAVPACK_PCM_MAXIMUM_FRAMES + 1]) {
		assert.throws(() => normalizePcmChunkFrames(value), RangeError);
	}
});
