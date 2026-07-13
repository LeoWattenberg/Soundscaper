import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applySpectralGain,
	deleteSpectralSelection,
} from '../src/lib/tools/audio-editor/spectral-edit.js';

test('spectral Delete attenuates the selected band while preserving other frequencies and time', () => {
	const sampleRate = 8_192;
	const frames = sampleRate;
	const input = Float32Array.from({ length: frames }, (_, frame) => (
		0.45 * Math.sin(2 * Math.PI * 1_024 * frame / sampleRate)
		+ 0.35 * Math.sin(2 * Math.PI * 3_072 * frame / sampleRate)
	));
	const output = deleteSpectralSelection([input], {
		sampleRate,
		startFrame: 2_048,
		endFrame: 6_144,
		minimumFrequency: 900,
		maximumFrequency: 1_150,
		windowSize: 1_024,
	})[0];
	assert.deepEqual(output.subarray(0, 2_048), input.subarray(0, 2_048));
	assert.deepEqual(output.subarray(6_144), input.subarray(6_144));
	assert.ok(toneAmplitude(output, 1_024, sampleRate, 3_000, 5_000) < 0.03);
	assert.ok(toneAmplitude(output, 3_072, sampleRate, 3_000, 5_000) > 0.3);
});

test('spectral Amplify applies dB gain and does not mutate inputs', () => {
	const sampleRate = 8_192;
	const input = Float32Array.from({ length: 4_096 }, (_, frame) => 0.1 * Math.sin(2 * Math.PI * 512 * frame / sampleRate));
	const before = input.slice();
	const output = applySpectralGain([input], {
		sampleRate,
		minimumFrequency: 450,
		maximumFrequency: 575,
		gainDb: 6.020599913,
		windowSize: 1_024,
	})[0];
	assert.deepEqual(input, before);
	assert.ok(Math.abs(toneAmplitude(output, 512, sampleRate, 1_000, 3_000) - 0.2) < 0.015);
});

test('spectral editor validates ranges and supports exact pass-through copies', () => {
	const input = Float32Array.of(0, 0.5, -0.5, 0);
	const output = applySpectralGain([input], { sampleRate: 8_000, gainDb: 0 });
	assert.notEqual(output[0], input);
	assert.deepEqual(output[0], input);
	assert.throws(() => deleteSpectralSelection([input], {
		sampleRate: 8_000,
		minimumFrequency: 2_000,
		maximumFrequency: 1_000,
	}), /minimumFrequency|maximumFrequency|between/);
});

function toneAmplitude(samples, frequency, sampleRate, start, end) {
	let sine = 0;
	let cosine = 0;
	const count = end - start;
	for (let frame = start; frame < end; frame += 1) {
		const angle = 2 * Math.PI * frequency * frame / sampleRate;
		sine += samples[frame] * Math.sin(angle);
		cosine += samples[frame] * Math.cos(angle);
	}
	return 2 * Math.hypot(sine, cosine) / count;
}
