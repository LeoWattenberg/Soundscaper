/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
	configureNativeSurroundDestination,
	downmixSurroundToStereo,
} from '../src/common/editor/surround-monitoring.ts';

test('native surround monitoring configures a capable discrete destination', () => {
	const destination = {
		maxChannelCount: 8,
		channelCount: 2,
		channelCountMode: 'max',
		channelInterpretation: 'speakers',
	};
	assert.equal(configureNativeSurroundDestination(destination, 6), true);
	assert.deepEqual(destination, {
		maxChannelCount: 8,
		channelCount: 6,
		channelCountMode: 'explicit',
		channelInterpretation: 'discrete',
	});
	assert.equal(configureNativeSurroundDestination({ maxChannelCount: 2 }, 6), false);
});

test('5.1 fallback monitoring omits LFE and applies normalized centre and surround gains', () => {
	const channels = [1, 2, 3, 99, 4, 5].map((value) => Float32Array.of(value, -value));
	const [left, right] = downmixSurroundToStereo(channels);
	const surroundGain = Math.SQRT1_2 * 0.5;
	assert.ok(Math.abs(left[0] - (0.5 + 3 * surroundGain + 4 * surroundGain)) < 1e-6);
	assert.ok(Math.abs(right[0] - (1 + 3 * surroundGain + 5 * surroundGain)) < 1e-6);
	assert.equal(left[1], -left[0]);
	assert.equal(right[1], -right[0]);
});

test('mono and stereo fallback monitoring retain their conventional mappings', () => {
	const mono = Float32Array.of(0.25, -0.5);
	assert.deepEqual(downmixSurroundToStereo([mono]).map((channel) => [...channel]), [[0.25, -0.5], [0.25, -0.5]]);
	const stereo = [Float32Array.of(1), Float32Array.of(2)];
	assert.deepEqual(downmixSurroundToStereo(stereo).map((channel) => [...channel]), [[1], [2]]);
});
