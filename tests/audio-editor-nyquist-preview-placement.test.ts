/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mixNyquistPreviewChannels } from '../src/common/editor/controller/effects/internal/nyquist/nyquist-audio.ts';

test('staggered Nyquist clip previews retain the audible gaps and their complete extent', () => {
	const first = new Float32Array([1, 1, 1, 1]);
	const second = new Float32Array([10, 10, 10, 10]);
	const output = mixNyquistPreviewChannels([[first], [second]], 10, [0, 2]);
	assert.deepEqual(Array.from(output[0] ?? []), [1, 1, 11, 11, 10, 10]);
	assert.deepEqual(Array.from(second), [10, 10, 10, 10]);
});

test('Nyquist placement respects the six-second window without pulling later audio forward', () => {
	const output = mixNyquistPreviewChannels([
		[new Float32Array([1, 2])],
		[new Float32Array([3, 4]), new Float32Array([5, 6])],
	], 4, [0, 6]);
	assert.deepEqual(output.map(channel => Array.from(channel)), [[1, 2, 0, 0], [1, 2, 0, 0]]);
});
