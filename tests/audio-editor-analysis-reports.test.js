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
	assert.ok(peak.db > -7 && peak.db < -5);
});

test('zero-crossing selection uses the nearest linked-channel crossing and quietest fallback', () => {
	const left = Float32Array.of(-1, -0.5, -0.1, 0.2, 0.8, 1, 0.4);
	const right = Float32Array.of(-0.8, -0.4, -0.05, 0.1, 0.7, 0.9, 0.3);
	assert.equal(findNearestAudioZeroCrossing([left, right], 5, { maximumDistance: 4 }), 3);
	assert.equal(findNearestAudioZeroCrossing([
		Float32Array.of(0.8, 0.4, 0.1, 0.3, 0.9),
	], 4, { maximumDistance: 4 }), 2);
});
