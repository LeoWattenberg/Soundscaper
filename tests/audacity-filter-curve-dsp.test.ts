/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudacityFilterCurveEq } from '../src/common/editor/audacity-effects/spectral.js';
import { initializePffft } from '../src/common/editor/pffft.js';
import { filterCurveKernelGain, filterCurveResponse } from '../src/common/editor/audacity-effects/filter-curve-response.ts';

await initializePffft();

// Direct cosine inverse transform of the spectrum specified by Audacity's
// EqualizationCurvesList::setCurve and EqualizationFilter::CalcFilter at
// 5ef610ed23260d6d648175735bb16b32536eb30b. Independent of the production FFT.
test('Filter Curve EQ matches Audacity kernel taps at subsonic frequencies and Nyquist', () => {
	const sampleRate = 8_000;
	const length = 21;
	const impulse = new Float32Array(length);
	impulse[(length - 1) / 2] = 1;
	for (const linearFrequencyScale of [false, true]) {
		const [actual] = applyAudacityFilterCurveEq([impulse], sampleRate, {
			points: [{ frequency: 1, gain: -60 }, { frequency: 100, gain: 6 }],
			filterLength: length, linearFrequencyScale,
		});
		const spectrum = Array.from({ length: 8_193 }, (_, bin) => {
			const frequency = bin * sampleRate / 16_384;
			const amount = linearFrequencyScale
				? Math.max(0, Math.min(1, (frequency - 1) / 99))
				: Math.min(1, Math.log(Math.max(20, frequency)) / Math.log(100));
			return 10 ** ((-60 + 66 * amount) / 20);
		});
		for (let tap = 0; tap < length; tap += 1) {
			const offset = tap - (length - 1) / 2;
			let sum = spectrum[0]! + spectrum[8_192]! * Math.cos(Math.PI * offset);
			for (let bin = 1; bin < 8_192; bin += 1) {
				sum += 2 * spectrum[bin]! * Math.cos(2 * Math.PI * bin * offset / 16_384);
			}
			const blackman = 0.42 - 0.5 * Math.cos(2 * Math.PI * tap / (length - 1))
				+ 0.08 * Math.cos(4 * Math.PI * tap / (length - 1));
			const expected = sum / 16_384 * blackman;
			assert.ok(Math.abs(actual![tap]! - expected) < 2e-6,
				`tap ${String(tap)}, linear=${String(linearFrequencyScale)}: ${String(actual![tap])} vs ${String(expected)}`);
		}
	}
});

test('the displayed response agrees with the applied impulse and reveals short-filter smoothing', async () => {
	const sampleRate = 48_000;
	const filterLength = 101;
	const points = [{ frequency: 900, gain: 0 }, { frequency: 1_000, gain: 20 }, { frequency: 1_100, gain: 0 }];
	const impulse = new Float32Array(filterLength);
	impulse[(filterLength - 1) / 2] = 1;
	const [kernel] = applyAudacityFilterCurveEq([impulse], sampleRate, { points, filterLength });
	const frequencies = [0, 20, 123.45, 1_000, 8_000, 24_000];
	const response = await filterCurveResponse(points, sampleRate, filterLength, false, frequencies);
	for (const [index, frequency] of frequencies.entries()) {
		let real = 0;
		let imaginary = 0;
		for (let tap = 0; tap < kernel!.length; tap += 1) {
			const angle = 2 * Math.PI * frequency * tap / sampleRate;
			real += kernel![tap]! * Math.cos(angle);
			imaginary -= kernel![tap]! * Math.sin(angle);
		}
		const expected = 20 * Math.log10(Math.hypot(real, imaginary));
		assert.ok(Math.abs(response[index]!.gain - expected) < 1e-4);
		assert.ok(Math.abs(filterCurveKernelGain(kernel!, frequency, sampleRate) - expected) < 1e-4);
	}
	assert.ok(response[3]!.gain < 10, 'a 101-tap filter cannot realize a narrow 20 dB peak');
});
