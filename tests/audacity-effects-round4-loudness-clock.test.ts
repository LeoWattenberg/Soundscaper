/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAudioChannels } from '../src/common/editor/analysis.js';
import { applyAudacityLoudnessNormalization } from '../src/common/editor/audacity-effects/basic.js';

for (const sampleRate of [11_025, 22_050, 48_000]) {
	for (const duration of [1, 2]) {
		test(`a phrase followed by silence reaches the LUFS target at ${sampleRate} Hz over ${duration} seconds`, () => {
			const samples = Float32Array.from({ length: sampleRate * duration }, (_, frame) =>
				frame < sampleRate * 0.4 ? 0.3 * Math.sin(2 * Math.PI * 1000 * frame / sampleRate) : 0);
			const normalized = applyAudacityLoudnessNormalization([samples], sampleRate, {
				targetLufs: -23, dualMono: false,
			});
			const actual = analyzeAudioChannels(normalized, sampleRate).integratedLufs;
			assert.notEqual(actual, null);
			// Audacity's K-weighting coefficients and the delivery meter differ
			// slightly at low sample rates; retain the 0.2 LU delivery tolerance.
			assert.ok(Math.abs(Number(actual) + 23) < 0.2, `Measured ${actual} LUFS`);
			assert.deepEqual(samples.subarray(Math.ceil(sampleRate * 0.4)),
				normalized[0]!.subarray(Math.ceil(sampleRate * 0.4)), 'normalization preserves the pause');
		});
	}
}
