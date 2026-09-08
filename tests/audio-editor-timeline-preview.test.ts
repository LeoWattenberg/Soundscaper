/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audioWarpSourceWindowRange } from '../src/common/editor/audio-warp-runtime.ts';
import {
	pcmWindowCoversProjectedClip,
	prepareRecordingPreviewWaveform,
	recordingPreviewId,
	recordingPreviewWaveformWindow,
} from '../src/common/editor/ui/timeline/preview.ts';

const projectedClip = {
	id: 'preview',
	timelineStartFrame: 0,
	durationFrames: 100,
	sourceStartFrame: 100,
	sourceDurationFrames: 200,
	waveformStartFrame: 20,
	waveformEndFrame: 60,
};

test('recording preview windows select canonical peak pairs', () => {
	const peaks = Float32Array.of(-1, 1, -0.8, 0.8, -0.6, 0.6, -0.4, 0.4, -0.2, 0.2);
	const window = recordingPreviewWaveformWindow(peaks, projectedClip);
	assert.deepEqual(window.map((value) => Number(value.toFixed(1))), [-0.8, 0.8, -0.6, 0.6]);
	assert.equal(recordingPreviewId('track'), 'recording-preview-track');
});

test('recording preview plans fill every requested summary column', () => {
	const rendering = prepareRecordingPreviewWaveform([
		[-1, 1, -0.5, 0.5],
	], projectedClip, 6.2);
	assert.equal(rendering.mode, 'summary');
	assert.equal(rendering.channels[0]?.minimum.length, 7);
	assert.equal(rendering.channels[0]?.maximum.length, 7);
	assert.equal([...rendering.channels[0].minimum].every(Number.isFinite), true);
	assert.equal([...rendering.channels[0].maximum].every(Number.isFinite), true);
});

test('PCM coverage maps projected timeline windows into forward and reversed source ranges', () => {
	assert.equal(pcmWindowCoversProjectedClip({ channels: [[0]], startFrame: 140, endFrame: 220 }, projectedClip), true);
	assert.equal(pcmWindowCoversProjectedClip({ channels: [[0]], startFrame: 141, endFrame: 220 }, projectedClip), false);
	assert.equal(pcmWindowCoversProjectedClip(
		{ channels: [[0]], startFrame: 180, endFrame: 260 },
		{ ...projectedClip, reversed: true },
	), true);
});

test('PCM coverage uses the authored warp map for a projected clip window', () => {
	const project = {
		sampleRate: 48_000,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const clip = {
		...projectedClip,
		kind: 'audio',
		anchor: 'sample',
		waveformStartFrame: 0,
		waveformEndFrame: 50,
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 100, mode: 'forward' as const },
				{ outer: 50, source: 110, mode: 'forward' as const },
				{ outer: 100, source: 300, mode: 'forward' as const },
			],
		},
	};
	const range = audioWarpSourceWindowRange(project, clip, {
		startFrame: clip.waveformStartFrame,
		endFrame: clip.waveformEndFrame,
		sourceFrameCount: 1_000,
	});

	assert.deepEqual(range, { startFrame: 98, endFrame: 112 });
	assert.equal(pcmWindowCoversProjectedClip({ channels: [[0]], ...range }, clip, project), true);
});
