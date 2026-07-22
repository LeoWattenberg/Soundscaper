import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applySpectralGain,
	applySpectralReplacement,
	deleteSpectralSelection,
} from '../src/common/editor/spectral-edit.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

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

test('spectral replacement takes processed bins only inside the selected band', () => {
	const sampleRate = 8_192;
	const frames = sampleRate;
	const input = Float32Array.from({ length: frames }, (_, frame) => (
		0.2 * Math.sin(2 * Math.PI * 512 * frame / sampleRate)
		+ 0.25 * Math.sin(2 * Math.PI * 2_048 * frame / sampleRate)
	));
	const replacement = Float32Array.from({ length: frames }, (_, frame) => (
		0.5 * Math.sin(2 * Math.PI * 512 * frame / sampleRate)
		+ 0.05 * Math.sin(2 * Math.PI * 2_048 * frame / sampleRate)
	));
	const before = input.slice();
	const processedBefore = replacement.slice();
	const output = applySpectralReplacement([input], [replacement], {
		sampleRate,
		minimumFrequency: 450,
		maximumFrequency: 575,
		windowSize: 1_024,
	})[0];
	assert.deepEqual(input, before);
	assert.deepEqual(replacement, processedBefore);
	assert.ok(Math.abs(toneAmplitude(output, 512, sampleRate, 2_000, 6_000) - 0.5) < 0.02);
	assert.ok(Math.abs(toneAmplitude(output, 2_048, sampleRate, 2_000, 6_000) - 0.25) < 0.02);
});

test('spectral replacement preserves time outside the rectangle and validates layouts', () => {
	const input = Float32Array.from({ length: 256 }, (_, frame) => Math.sin(frame / 8));
	const replacement = Float32Array.from({ length: 256 }, () => 0);
	const output = applySpectralReplacement([input], [replacement], {
		sampleRate: 8_000,
		startFrame: 64,
		endFrame: 192,
		minimumFrequency: 0,
		maximumFrequency: 4_000,
		windowSize: 64,
	})[0];
	assert.deepEqual(output.subarray(0, 64), input.subarray(0, 64));
	assert.deepEqual(output.subarray(192), input.subarray(192));
	assert.ok(output.subarray(80, 176).every((sample) => Math.abs(sample) < 1e-5));
	assert.throws(() => applySpectralReplacement([input], [replacement, replacement], {
		sampleRate: 8_000,
	}), /channel counts/);
	assert.throws(() => applySpectralReplacement([input], [replacement.subarray(0, 128)], {
		sampleRate: 8_000,
	}), /frame counts/);
});

test('spectral reconstruction preserves finite float PCM above conventional audio amplitude', () => {
	const input = new Float32Array(4_096).fill(20);
	const replacement = applySpectralReplacement([input], [input], {
		sampleRate: 48_000,
		minimumFrequency: 100,
		maximumFrequency: 200,
		windowSize: 512,
	})[0];
	const attenuated = applySpectralGain([input], {
		sampleRate: 48_000,
		minimumFrequency: 100,
		maximumFrequency: 200,
		windowSize: 512,
		gainDb: -6,
	})[0];
	assert.ok(Math.abs(replacement[1_000] - 20) < 1e-4);
	assert.ok(Math.abs(attenuated[1_000] - 20) < 1e-4);
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
