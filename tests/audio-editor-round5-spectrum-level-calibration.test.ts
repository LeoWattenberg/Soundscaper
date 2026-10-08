/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';

for (const size of [64, 2048, 65_536]) {
	for (const amplitude of [1, 0.5, 0.01]) {
		test(`Hann spectrum calibrates a ${amplitude} sine at FFT size ${size}`, () => {
			const bin = 8;
			const input = Float32Array.from({ length: size }, (_, frame) => amplitude * Math.sin(2 * Math.PI * bin * frame / size));
			const peak = calculateAudioSpectrum([input], 48_000, { size }).bins[bin]!;
			assert.ok(Math.abs(peak.db - 20 * Math.log10(amplitude)) < 0.001, `measured ${peak.db} dB`);
			assert.deepEqual(calculateAudioSpectrum([input], 48_000, { size }).bins[bin], peak, 'cached window keeps the same calibration');
		});
	}
}

test('one-sided spectrum keeps the undoubled DC and Nyquist endpoints', () => {
	for (const size of [64, 2048]) {
		for (const bin of [0, size / 2]) {
			const input = Float32Array.from({ length: size }, (_, frame) => 0.5 * Math.cos(2 * Math.PI * bin * frame / size));
			const peak = calculateAudioSpectrum([input], 48_000, { size }).bins[bin]!;
			assert.ok(Math.abs(peak.db - 20 * Math.log10(0.5)) < 0.001);
		}
	}
});

test('window compensation leaves opposite-polarity channel pooling intact', () => {
	const input = Float32Array.from({ length: 2048 }, (_, frame) => 0.5 * Math.sin(2 * Math.PI * 32 * frame / 2048));
	const mono = calculateAudioSpectrum([input], 48_000, { size: 2048 });
	const stereo = calculateAudioSpectrum([input, Float32Array.from(input, value => -value)], 48_000, { size: 2048 });
	for (const [index, bin] of mono.bins.entries()) {
		assert.ok(Math.abs(stereo.bins[index]!.amplitude - bin.amplitude) < 1e-12);
	}
});
