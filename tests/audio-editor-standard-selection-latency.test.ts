/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';

test('gate selection preview preserves the first transient at its original timestamp and flushes the final samples', () => {
	for (const sampleRate of [8000, 48000, 192000]) {
		const input = [new Float32Array(257), new Float32Array(257)];
		input[0][0] = 1;
		input[1][0] = -.5;
		input[0][256] = .25;
		input[1][256] = -.125;
		const params = { threshold: -40, attack: .01, lookahead: .01, rangeDb: -100, hold: .05, release: .1 };
		const processed = applyStandardEffect('noise-gate', input, sampleRate, params);
		assert.deepEqual(processed, input, `${String(sampleRate)} Hz: preserve both ends without moving the audio`);
		const causal = applyStandardEffect('noise-gate', input, sampleRate, { ...params, lookahead: 0 });
		assert.ok(causal[0][0] < .1, 'the preview gives the gate time to open for a transient');
	}
});

test('gate selection compensation preserves every frame when preview spans multiple processing blocks', () => {
	const input = [Float32Array.from({ length: 1025 }, (_, frame) => .4 * Math.sin(frame / 13) + .1)];
	const untouched = input[0].slice();
	const output = applyStandardEffect('noise-gate', input, 48000, { lookahead: .123, rangeDb: 0 });
	assert.deepEqual(output, input);
	assert.deepEqual(input[0], untouched);
});
