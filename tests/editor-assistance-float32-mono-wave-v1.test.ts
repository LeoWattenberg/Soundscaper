/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	reviewAssistanceFloat32MonoWaveV1,
} from '../src/common/editor/assistance/float32-mono-wave-v1.ts';
import { encodeWav } from '../src/common/editor/wav.js';

function wave(samples: readonly Float32Array[], sampleRate = 32_000): Uint8Array {
	return encodeWav(samples, { sampleRate, bitDepth: 32, float: true, dither: false });
}

test('Float32 mono WAV admission copies exact finite prepared samples', () => {
	const bytes = wave([Float32Array.of(-0.5, 0, 0.75)]);
	const result = reviewAssistanceFloat32MonoWaveV1(bytes, 32_000);

	assert.equal(result.sampleRate, 32_000);
	assert.deepEqual(result.samples, Float32Array.of(-0.5, 0, 0.75));
	bytes.fill(0);
	assert.deepEqual(result.samples, Float32Array.of(-0.5, 0, 0.75));
});

test('Float32 mono WAV admission refuses rate, channel, encoding, and sample substitutions', () => {
	assert.throws(() => reviewAssistanceFloat32MonoWaveV1(
		wave([new Float32Array(4)], 16_000), 32_000,
	), /sample rate|32|requested rate/iu);
	assert.throws(() => reviewAssistanceFloat32MonoWaveV1(
		wave([new Float32Array(4), new Float32Array(4)]), 32_000,
	), /mono|Float32|format/iu);

	const integerWave = encodeWav([new Float32Array(4)], {
		sampleRate: 32_000, bitDepth: 16, float: false, dither: false,
	});
	assert.throws(() => reviewAssistanceFloat32MonoWaveV1(integerWave, 32_000),
		/Float32|format/iu);

	const notFinite = wave([new Float32Array(4)]);
	new DataView(notFinite.buffer, notFinite.byteOffset, notFinite.byteLength)
		.setFloat32(44, Number.NaN, true);
	assert.throws(() => reviewAssistanceFloat32MonoWaveV1(notFinite, 32_000),
		/finite|sample/iu);
});

test('Float32 mono WAV admission rejects truncated, trailing, and contradictory RIFF authority', () => {
	const valid = wave([new Float32Array(4)]);
	assert.throws(() => reviewAssistanceFloat32MonoWaveV1(valid.subarray(0, valid.length - 1), 32_000),
		/RIFF|truncated|exact/iu);
	const trailing = new Uint8Array(valid.length + 1);
	trailing.set(valid);
	assert.throws(() => reviewAssistanceFloat32MonoWaveV1(trailing, 32_000), /RIFF|exact/iu);
	const contradictory = new Uint8Array(valid);
	new DataView(contradictory.buffer).setUint32(40, 0xffff_ffff, true);
	assert.throws(() => reviewAssistanceFloat32MonoWaveV1(contradictory, 32_000),
		/truncated|chunk|data/iu);
});
