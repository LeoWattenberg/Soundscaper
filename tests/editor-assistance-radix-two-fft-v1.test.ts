/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeAssistanceDeepFilterChannelV1 } from '../src/common/editor/assistance/deepfilternet3-signal-v1.ts';
import { fftRadixTwoFloat64V1 } from '../src/common/editor/assistance/internal/radix-two-fft-v1.ts';

test('Float64 radix-two FFT has a stable forward golden and inverse round trip', () => {
	const real = Float64Array.of(1, 2, 3, 4);
	const imaginary = new Float64Array(4);
	fftRadixTwoFloat64V1(real, imaginary, false);
	assertPlaneNear(real, [10, -2, -2, -2]);
	assertPlaneNear(imaginary, [0, 2, 0, -2]);
	fftRadixTwoFloat64V1(real, imaginary, true);
	for (let index = 0; index < real.length; index += 1) {
		assert.ok(Math.abs(real[index]! - (index + 1)) < 1e-12);
		assert.ok(Math.abs(imaginary[index]!) < 1e-12);
	}
});

test('DeepFilterNet3 keeps its centered impulse spectrum after sharing the radix-two kernel', () => {
	const analysis = analyzeAssistanceDeepFilterChannelV1(Float32Array.of(1));
	assert.equal(analysis.frameCount, 2);
	for (let frequency = 0; frequency < 8; frequency += 1) {
		const expected = (frequency % 2 === 0 ? 1 : -1) / 960;
		assert.ok(Math.abs(analysis.spectrumReal[frequency]! - expected) < 1e-10);
		assert.ok(Math.abs(analysis.spectrumImaginary[frequency]!) < 1e-12);
	}
});

function assertPlaneNear(actual: Float64Array, expected: readonly number[]): void {
	assert.equal(actual.length, expected.length);
	for (let index = 0; index < actual.length; index += 1) {
		assert.ok(Math.abs(actual[index]! - expected[index]!) < 1e-12);
	}
}
