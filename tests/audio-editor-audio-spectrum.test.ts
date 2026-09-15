/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';
import { calculateAudioSpectrum as publicSpectrum } from '../src/common/editor/analysis.js';

test('the public spectrum entry uses the same bounded FFT implementation', () => {
	assert.equal(publicSpectrum, calculateAudioSpectrum);
	const rate = 8_192;
	const samples = Float32Array.from({ length: 2_048 }, (_, frame) => frame < 1_024 ? 0 : Math.sin(2 * Math.PI * 512 * frame / rate));
	const spectrum = calculateAudioSpectrum([samples], rate, { size: 1_024, offsetFrame: 1_024 });
	const peak = spectrum.bins.reduce((best, bin) => best.amplitude > bin.amplitude ? best : bin);
	assert.equal(peak.frequency, 512);
	assert.ok(peak.db > -7 && peak.db < -5);
	assert.ok(Object.isFrozen(spectrum) && Object.isFrozen(spectrum.bins));
});

test('spectrum rejects invalid PCM, rates and unbounded FFT windows', () => {
	assert.throws(() => calculateAudioSpectrum([], 48_000), /Float32/u);
	assert.throws(() => calculateAudioSpectrum([new Float32Array(3), new Float32Array(4)], 48_000), /equal lengths/u);
	assert.throws(() => calculateAudioSpectrum([new Float32Array(32)], 0), /sample rate/u);
	for (const size of [16, 33, 131_072]) {
		assert.throws(() => calculateAudioSpectrum([new Float32Array(32)], 48_000, { size }), /power of two/u);
	}
	assert.ok(calculateAudioSpectrum([new Float32Array(32)], 48_000, { offsetFrame: 100 }).bins.every(bin => bin.amplitude === 0 && bin.db === -120));
});
