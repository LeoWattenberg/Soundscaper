/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect, effectTailFrames, rackTailFrames } from '../src/common/editor/effects.js';
import { createAudacityLiveProcessor } from '../src/common/editor/audacity-effects/live.js';

const RATE = 48_000;
for (const [family, cutoffHz, order] of [
	['butterworth', 10, 1], ['butterworth', 250, 8], ['chebyshev-i', 100, 6], ['chebyshev-ii', 100, 5],
] as const) {
	test(`${family} Classic Filters publishes and completes its audible release`, () => {
		const params = { family, cutoffHz, order };
		const effect = createEffect('audacity-classic-filters', { params });
		const processor = createAudacityLiveProcessor('audacity-classic-filters', RATE, params);
		processor.process([new Float32Array(RATE).fill(.5)], [new Float32Array(RATE)]);
		const first = new Float32Array(128);
		processor.process([new Float32Array(128)], [first]);
		assert.ok(first.some(sample => Math.abs(sample) > .001), 'The audible release must actually exist.');
		const declared = effectTailFrames(effect, RATE);
		assert.ok(declared > 128, `The export must reserve the audible ${family} filter tail.`);
		assert.equal(processor.tailFrames, declared);
		const release = new Float32Array(declared + 128);
		processor.process([new Float32Array(release.length)], [release]);
		assert.ok(release.subarray(declared).every(sample => Number.isFinite(sample) && Math.abs(sample) < .0001));
	});
}

test('Classic Filters retains the ordinary rack release cap for long low-cutoff ringing', () => {
	const effect = createEffect('audacity-classic-filters', { params: { family: 'chebyshev-i', cutoffHz: 1, order: 10 } });
	assert.ok(effectTailFrames(effect, RATE) > RATE * 10);
	assert.equal(rackTailFrames([effect], RATE), RATE * 10);
});
