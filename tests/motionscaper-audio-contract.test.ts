/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMotionAudioFormat, normalizeMotionAudioBlockRequest, validateMotionAudioWindow } from '../src/common/editor/motion-audio-contract.ts';

test('M05 audio blocks preserve fractional sample starts and admit only bounded mono/stereo PCM', () => {
	assert.deepEqual(normalizeMotionAudioBlockRequest({ compositionId: 'main', startSample: { num: 3, den: 2 }, sampleRate: 48000, sampleCount: 1024, channels: 2 }),
		{ compositionId: 'main', startSample: { num: 3, den: 2 }, sampleRate: 48000, sampleCount: 1024, channels: 2 });
	assert.throws(() => normalizeMotionAudioBlockRequest({ compositionId: 'main', startSample: 0, sampleRate: 48000, sampleCount: 65537, channels: 2 }), /block/iu);
	assert.throws(() => normalizeMotionAudioFormat({ sampleRate: 48000, sampleCount: 1000, channels: 6 }), /mono.*stereo/iu);
	assert.throws(() => normalizeMotionAudioFormat({ sampleRate: 48000, sampleCount: Infinity, channels: 1 }), /sample count/iu);
});

test('M05 audio provider windows must have exact interleaved length and finite decoded samples', () => {
	const format = normalizeMotionAudioFormat({ sampleRate: 44100, sampleCount: 100, channels: 2 });
	assert.doesNotThrow(() => validateMotionAudioWindow(new Float32Array([1, -1, 0, 0]), 2, format));
	assert.throws(() => validateMotionAudioWindow(new Float32Array(3), 2, format), /length/iu);
	assert.throws(() => validateMotionAudioWindow(new Float32Array([NaN, 0]), 1, format), /finite/iu);
});
