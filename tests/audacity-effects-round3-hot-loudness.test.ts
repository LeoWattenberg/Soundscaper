/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAudioChannels } from '../src/common/editor/analysis.js';
import { applyAudacityLoudnessNormalization } from '../src/common/editor/audacity-effects/basic.js';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';

const sampleRate = 48_000;

function square(): Float32Array {
	return generateAudioEditorSignal('tone', {
		sampleRate, frequency: 10_000, amplitude: 0.8, waveform: 'square', durationSeconds: 1,
	}).channels[0]!;
}

test('perceived-loudness normalization measures a high-frequency square below sample clipping', () => {
	const input = [square()];
	assert.ok(input[0]!.every(sample => Math.abs(sample) < 1));
	const normalized = applyAudacityLoudnessNormalization(input, sampleRate, {
		targetLufs: -23, dualMono: false,
	});
	const result = analyzeAudioChannels(normalized, sampleRate);
	assert.notEqual(result.integratedLufs, null);
	assert.ok(Math.abs(Number(result.integratedLufs) + 23) < 0.05, String(result.integratedLufs));
});

test('loudness normalization retains stereo balance when high weighted powers exceed the original histogram', () => {
	const first = square();
	const second = Float32Array.from(first, sample => sample * 0.5);
	const normalized = applyAudacityLoudnessNormalization([first, second], sampleRate, {
		targetLufs: -23, dualMono: false, stereoIndependent: false,
	});
	assert.ok(Math.abs(Number(analyzeAudioChannels(normalized, sampleRate).integratedLufs) + 23) < 0.05);
	for (let frame = 0; frame < first.length; frame += 1) {
		assert.equal(normalized[1]![frame], normalized[0]![frame]! * 0.5);
	}
});

test('normalizing an ordinary waveform reaches the same result after a preceding gain change', () => {
	const original = square();
	const amplified = Float32Array.from(original, sample => sample * 4);
	const params = { targetLufs: -23, dualMono: false };
	const first = applyAudacityLoudnessNormalization([original], sampleRate, params)[0]!;
	const second = applyAudacityLoudnessNormalization([amplified], sampleRate, params)[0]!;
	assert.ok(first.some((sample: number) => Math.abs(sample) > 0.01));
	for (let frame = 0; frame < first.length; frame += 1) {
		assert.ok(Math.abs(first[frame]! - second[frame]!) < 0.00001);
	}
});
