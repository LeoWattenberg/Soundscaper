import assert from 'node:assert/strict';
import test from 'node:test';

import {
	fft,
	initializePffft,
	pffftSimdSize,
} from '../src/common/editor/pffft.js';

await initializePffft();

test('shared PFFFT performs normalized ordered complex round trips', () => {
	for (const size of [32, 64, 256, 2_048, 16_384]) {
		const real = Float64Array.from({ length: size }, (_, index) =>
			Math.sin(index * 0.31) + Math.cos(index * 0.07));
		const expected = real.slice();
		const imaginary = new Float64Array(size);
		fft(real, imaginary, false);
		fft(real, imaginary, true);
		for (let index = 0; index < size; index += 1) {
			assert.ok(Math.abs(real[index] - expected[index]) < 1e-5, `${size}-point real sample ${index}`);
			assert.ok(Math.abs(imaginary[index]) < 1e-5, `${size}-point imaginary sample ${index}`);
		}
	}
	assert.equal(pffftSimdSize(), 4);
});

test('shared PFFFT rejects layouts unsupported by the production plans', () => {
	assert.throws(() => fft(new Float64Array(16), new Float64Array(16)), /at least 32/);
	assert.throws(() => fft(new Float64Array(64), new Float64Array(32)), /same length/);
	assert.throws(() => fft(new Float64Array(96), new Float64Array(96)), /power-of-two/);
});
