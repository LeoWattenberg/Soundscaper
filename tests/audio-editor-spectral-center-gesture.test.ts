/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	moveSpectralBandCenter,
	spectralBandCenter,
	spectralSelectionPeaks,
	snapSpectralCenterToPeak,
	selectedTrackSpectralPeaks,
} from '../src/common/editor/ui/timeline/spectral-center-gesture.ts';
import { spectrogramFrequencyFraction, spectrogramScaleValue } from '../src/common/editor/ui/timeline/geometry.ts';

test('moving a spectral band preserves its displayed bandwidth and time selection', () => {
	const band = { startFrame: 10, endFrame: 100, minimumFrequency: 200, maximumFrequency: 800 };
	for (const scale of ['linear', 'logarithmic', 'mel'] as const) {
		const moved = moveSpectralBandCenter(band, 2_000, scale, 0, 24_000);
		const width = (low: number, high: number) => spectrogramFrequencyFraction(high, scale, 0, 24_000)
			- spectrogramFrequencyFraction(low, scale, 0, 24_000);
		assert.ok(Math.abs(width(moved.minimumFrequency, moved.maximumFrequency) - width(200, 800)) < 1e-8);
		assert.ok(Math.abs(spectralBandCenter(moved, scale, 0, 24_000) - 2_000) < 1e-4);
		assert.equal(moved.startFrame, 10);
		assert.equal(moved.endFrame, 100);
	}
});

test('peak snapping analyzes the selected source interval and independent stereo channels', () => {
	const rate = 8_192;
	const samples = Float32Array.from({ length: rate * 2 }, (_, frame) => Math.sin(2 * Math.PI * (frame < rate ? 256 : 768) * frame / rate));
	const clips = [{ id: 'audio', sourceId: 'source', timelineStartFrame: 0, durationFrames: rate * 2,
		sourceStartFrame: 0, waveformStartFrame: 0, waveformEndFrame: rate * 2 }];
	const controller = { getClipVisualData: () => ({ pcmWindow: { startFrame: rate, endFrame: rate * 2,
		channels: [samples.subarray(rate), Float32Array.from(samples.subarray(rate), value => -value)] } }) };
	const peaks = selectedTrackSpectralPeaks(controller, clips, { startFrame: rate, endFrame: rate * 2 }, rate);
	assert.equal(snapSpectralCenterToPeak(700, peaks), 768);
	assert.ok(!peaks.includes(256));
	assert.deepEqual(selectedTrackSpectralPeaks(controller, clips, { startFrame: rate * 3, endFrame: rate * 4 }, rate), []);
});

test('spectral center movement clamps the entire band at display limits', () => {
	const band = { minimumFrequency: 1_000, maximumFrequency: 3_000 };
	assert.deepEqual(moveSpectralBandCenter(band, 24_000, 'linear', 0, 24_000), {
		minimumFrequency: 22_000, maximumFrequency: 24_000,
	});
	assert.deepEqual(moveSpectralBandCenter(band, 0, 'linear', 0, 24_000), {
		minimumFrequency: 0, maximumFrequency: 2_000,
	});
});

test('moving a band back into a zoomed display retains its full bandwidth', () => {
	const band = { minimumFrequency: 2_000, maximumFrequency: 2_200 };
	for (const scale of ['linear', 'logarithmic', 'mel'] as const) {
		const moved = moveSpectralBandCenter(band, 500, scale, 0, 1_000);
		const width = spectrogramScaleValue(band.maximumFrequency, scale) - spectrogramScaleValue(band.minimumFrequency, scale);
		const movedWidth = spectrogramScaleValue(moved.maximumFrequency, scale) - spectrogramScaleValue(moved.minimumFrequency, scale);
		assert.ok(moved.maximumFrequency > moved.minimumFrequency);
		assert.ok(Math.abs(width - movedWidth) < 1e-5);
	}
});

test('spectral snapping finds real selected-audio peaks, ignoring silence and leakage', () => {
	const rate = 8_192;
	const samples = Float32Array.from({ length: 8_192 }, (_, frame) => Math.sin(2 * Math.PI * 512 * frame / rate)
		+ 0.5 * Math.sin(2 * Math.PI * 1_024 * frame / rate));
	const peaks = spectralSelectionPeaks([samples], rate, 2_048);
	assert.ok(peaks.some(frequency => Math.abs(frequency - 512) < 4));
	assert.ok(peaks.some(frequency => Math.abs(frequency - 1_024) < 4));
	assert.equal(snapSpectralCenterToPeak(600, peaks), 512);
	assert.equal(snapSpectralCenterToPeak(900, peaks), 1_024);
	assert.deepEqual(spectralSelectionPeaks([new Float32Array(2_048)], rate), []);
	assert.equal(snapSpectralCenterToPeak(600, []), 600);
});

test('peak snapping estimates frequencies between FFT bins', () => {
	const samples = Float32Array.from({ length: 4_096 }, (_, frame) => Math.sin(2 * Math.PI * 512 * frame / 48_000));
	const peak = snapSpectralCenterToPeak(550, spectralSelectionPeaks([samples], 48_000));
	assert.ok(Math.abs(peak - 512) < 1);
});
