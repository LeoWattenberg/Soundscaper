/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { pitchFrequencyBounds, pitchOctaveBounds, pitchFrequencyAvailable } from '../src/common/editor/ui/audacity-pitch-frequency-bounds.ts';

test('alternate frequency inputs only offer the supported octave around the retained other pitch', () => {
	assert.deepEqual(pitchFrequencyBounds(440), [220, 880]);
	assert.deepEqual(pitchFrequencyBounds(1), [1, 2]);
	assert.deepEqual(pitchFrequencyBounds(100_000), [50_000, 100_000]);
	for (const value of [220, 440, 880]) assert.equal(pitchFrequencyAvailable(440, value), true);
	for (const value of [110, 1760]) assert.equal(pitchFrequencyAvailable(440, value), false);
});

test('note octave fields retain only octaves that can represent the requested shift', () => {
	assert.deepEqual(pitchOctaveBounds(440, 440 / 16), [3, 5]);
	assert.deepEqual(pitchOctaveBounds(450, 440 / 16), [4, 5]);
});
