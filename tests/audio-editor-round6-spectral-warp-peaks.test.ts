/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderExactAudioWarpPcm } from '../src/common/editor/audio-warp-render-parity.ts';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';
import { selectedTrackSpectralPeaks, snapSpectralCenterToPeak } from '../src/common/editor/ui/timeline/spectral-center-gesture.ts';

test('spectral snapping follows the audible frequency of an authored warp segment', () => {
	const sampleRate = 48_000;
	const sourceRate = 8192;
	const project = { sampleRate, tempoMap: { mode: 'musical' as const,
		events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] } };
	const tone = Float32Array.from({ length: sourceRate * 4 }, (_, frame) =>
		.5 * Math.sin(2 * Math.PI * 512 * frame / sourceRate));
	const clip = { id: 'warped', kind: 'audio', anchor: 'sample', sourceId: 'tone',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: tone.length,
		durationFrames: sampleRate * 4, waveformStartFrame: 0, waveformEndFrame: sampleRate * 4,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: sampleRate * 2, source: sourceRate * 3, mode: 'forward' },
			{ outer: sampleRate * 4, source: sourceRate * 4, mode: 'forward' },
		] } };
	const selection = { startFrame: sampleRate, endFrame: sampleRate * 1.5 };
	const audible = renderExactAudioWarpPcm(project, clip, {
		...selection, sourceSampleRate: sourceRate,
	}, [tone]);
	const spectrum = calculateAudioSpectrum(audible, sampleRate, { size: 16_384 });
	const peak = spectrum.bins.reduce((highest, bin) => bin.amplitude > highest.amplitude ? bin : highest);
	assert.ok(Math.abs(peak.frequency - 768) < 2, 'production warp rendering raises this segment to 768 Hz');
	const controller = { project, getClipVisualData: () => ({ source: { sampleRate: sourceRate },
		buffer: { numberOfChannels: 1, getChannelData: () => tone } }) };
	assert.ok(Math.abs(snapSpectralCenterToPeak(800,
		selectedTrackSpectralPeaks(controller, [clip], selection, sampleRate)) - 768) < 1);
});
