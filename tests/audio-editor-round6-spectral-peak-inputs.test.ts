/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectedTrackSpectralPeaks, snapSpectralCenterToPeak } from '../src/common/editor/ui/timeline/spectral-center-gesture.ts';

const rate = 8192;
const tone = Float32Array.from({ length: rate * 4 }, (_, frame) => .5 * Math.sin(2 * Math.PI * 512 * frame / rate));

test('independent tempo stretching retains the native pitch while snapping spectral peaks', () => {
	const controller = { getClipVisualData: () => ({ source: { sampleRate: rate },
		buffer: { numberOfChannels: 1, getChannelData: () => tone } }) };
	const clip = { id: 'tone', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
		sourceDurationFrames: tone.length, durationFrames: 48_000 * 2, waveformStartFrame: 0, waveformEndFrame: 48_000 * 2,
		speedRatio: 2, linkPitchAndTempo: false, pitchCents: 0 };
	const peaks = selectedTrackSpectralPeaks(controller, [clip], { startFrame: 0, endFrame: clip.durationFrames }, 48_000);
	assert.ok(Math.abs(snapSpectralCenterToPeak(550, peaks) - 512) < 1, 'tempo alone does not transpose the selected audio');
});

