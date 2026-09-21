/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertFiniteFloat32Pcm } from '../desktop/finite-float32-pcm.ts';

class PcmError extends Error {}

function bytes(...samples: number[]): Uint8Array {
	const result = new Uint8Array(samples.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(result.buffer);
	samples.forEach((sample, index) => {
		view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, sample, true);
	});
	return result;
}

test('finite Float32 validation accepts canonical values including negative zero', () => {
	assert.doesNotThrow(() => assertFiniteFloat32Pcm(
		bytes(0, -0, 1, -1, Math.fround(Math.PI)),
		() => new PcmError(),
	));
});

test('finite Float32 validation uses the caller error for alignment and nonfinite values', () => {
	for (const value of [new Uint8Array(3), bytes(Number.NaN), bytes(Infinity), bytes(-Infinity)]) {
		assert.throws(
			() => assertFiniteFloat32Pcm(value, () => new PcmError('invalid PCM')),
			(error) => error instanceof PcmError && error.message === 'invalid PCM',
		);
	}
});
