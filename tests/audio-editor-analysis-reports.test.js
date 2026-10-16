import assert from 'node:assert/strict';
import test from 'node:test';

import {
	analyzeAudioContrast,
	calculateAudioSpectrum,
	findAudioClippingRegions,
	findNearestAudioZeroCrossing,
} from '../src/common/editor/analysis.js';

test('Find Clipping returns linked regions with configurable consecutive samples', () => {
	const left = Float32Array.of(0, 1.1, 1.2, 1.3, 0, 1.1, 0);
	const right = Float32Array.of(0, 0, -1.4, -1.2, 0, 0, 0);
	const regions = findAudioClippingRegions([left, right], { minimumConsecutiveSamples: 3 });
	assert.deepEqual(regions, [{
		startFrame: 1,
		endFrame: 4,
		frameCount: 3,
		clippedSamples: 5,
		peakAmplitude: Math.abs(right[2]),
	}]);
});

test('Contrast reports the RMS difference and pass threshold', () => {
	const foreground = [Float32Array.from({ length: 1_000 }, () => 0.5)];
	const background = [Float32Array.from({ length: 1_000 }, () => 0.025)];
	const report = analyzeAudioContrast(foreground, background);
	assert.ok(Math.abs(report.differenceDb - 26.0206) < 0.01);
	assert.equal(report.passes, true);
	assert.equal(analyzeAudioContrast(foreground, background, { minimumDifferenceDb: 30 }).passes, false);
});

test('Plot Spectrum resolves a windowed tone into the expected frequency bin', () => {
	const sampleRate = 8_192;
	const input = Float32Array.from({ length: 2_048 }, (_, frame) => Math.sin(2 * Math.PI * 1_024 * frame / sampleRate));
	const spectrum = calculateAudioSpectrum([input], sampleRate, { size: 2_048 });
	const peak = spectrum.bins.reduce((best, bin) => bin.amplitude > best.amplitude ? bin : best);
	assert.equal(peak.frequency, 1_024);
	assert.ok(Math.abs(peak.db) < 0.001, 'a full-scale sine reports 0 dB after Hann gain compensation');
});

test('zero-crossing selection uses the nearest linked-channel crossing and quietest fallback', () => {
	const left = Float32Array.of(-1, -0.5, -0.1, 0.2, 0.8, 1, 0.4);
	const right = Float32Array.of(-0.8, -0.4, -0.05, 0.1, 0.7, 0.9, 0.3);
	assert.equal(findNearestAudioZeroCrossing([left, right], 5, { maximumDistance: 4 }), 3);
	assert.equal(findNearestAudioZeroCrossing([
		Float32Array.of(0.8, 0.4, 0.1, 0.3, 0.9),
	], 4, { maximumDistance: 4 }), 2);
});

test('stereo zero-crossing selection avoids a loud uncrossed channel', () => {
	const left = Float32Array.of(0.8, -0.8, -0.8, -0.2, 0.2);
	const right = Float32Array.of(0.8, 0.8, 0.8, -0.2, 0.2);
	assert.equal(findNearestAudioZeroCrossing([left, right], 1, { maximumDistance: 3 }), 4,
		'a common crossing is preferred over an earlier left-only crossing');

	const noCommonLeft = Float32Array.of(-1, 0.9, 0.1);
	const noCommonRight = Float32Array.of(0.9, 0.8, 0.2);
	assert.equal(findNearestAudioZeroCrossing([noCommonLeft, noCommonRight], 0, { maximumDistance: 2 }), 2,
		'the quietest stereo frame is used when only one channel crosses');
});
