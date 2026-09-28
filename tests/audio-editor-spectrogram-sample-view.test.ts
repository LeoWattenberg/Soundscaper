/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSpectrogramSampleViews,
} from '../src/common/editor/ui/timeline/spectrogram-sample-view.ts';

test('spectrogram sample views read the projected PCM window with its source offset', () => {
	const clip = {
		timelineStartFrame: 10,
		durationFrames: 8,
		sourceStartFrame: 4,
		sourceDurationFrames: 8,
		waveformStartFrame: 2,
		waveformEndFrame: 6,
	};
	const views = createSpectrogramSampleViews([
		Float32Array.from([7, 8, 9, 10]),
		Float32Array.from([17, 18, 19, 20]),
	], clip, { sourceFrameOffset: 6 });

	assert.equal(views.length, 2);
	assert.equal(views[0]?.length, 4);
	assert.deepEqual([0, 1, 2, 3].map((index) => views[0]?.sampleAt(index)), [7, 8, 9, 10]);
	assert.deepEqual([0, 1, 2, 3].map((index) => views[1]?.sampleAt(index)), [17, 18, 19, 20]);
	assert.equal(views[0]?.sampleAt(-1), 0);
	assert.equal(views[0]?.sampleAt(4), 0);
});

test('spectrogram sample views use the clip stretch and reverse source mapping', () => {
	const samples = Float32Array.from({ length: 16 }, (_, index) => index + 1);
	const clip = {
		timelineStartFrame: 0,
		durationFrames: 4,
		sourceStartFrame: 4,
		sourceDurationFrames: 8,
		waveformStartFrame: 0,
		waveformEndFrame: 4,
	};
	const forward = createSpectrogramSampleViews([samples], clip, {})[0]!;
	const reversed = createSpectrogramSampleViews([samples], { ...clip, reversed: true }, {})[0]!;

	assert.deepEqual([0, 1, 2, 3].map((index) => forward.sampleAt(index)), [5, 7, 9, 11]);
	assert.deepEqual([0, 1, 2, 3].map((index) => reversed.sampleAt(index)), [12, 10, 8, 6]);
});

test('spectrogram sample views apply signed gain and the clip fade envelope', () => {
	const view = createSpectrogramSampleViews([new Float32Array(8).fill(1)], {
		timelineStartFrame: 0,
		durationFrames: 8,
		sourceStartFrame: 0,
		sourceDurationFrames: 8,
		waveformStartFrame: 0,
		waveformEndFrame: 8,
		gain: 2,
		inverted: true,
		fadeInFrames: 4,
		fadeOutFrames: 4,
	}, {})[0]!;

	assert.deepEqual([0, 1, 2, 4, 6, 7].map((index) => view.sampleAt(index)),
		[0, -0.5, -1, -2, -1, -0.5]);
});

test('spectrogram sample views follow authored warp points and retain late PCM', () => {
	const project = {
		sampleRate: 4,
		tempoMap: { mode: 'musical' as const,
			events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] },
	};
	const clip = {
		kind: 'audio', anchor: 'sample', timelineStartFrame: 20,
		durationFrames: 4, sourceStartFrame: 10, sourceDurationFrames: 8,
		waveformStartFrame: 1, waveformEndFrame: 4,
		warpMap: { feature: 'audio-warp' as const, points: [
			{ outer: 0, source: 10, mode: 'forward' as const },
			{ outer: 2, source: 11, mode: 'forward' as const },
			{ outer: 4, source: 18, mode: 'forward' as const },
		] },
	};
	const samples = Float32Array.from({ length: 8 }, (_, index) => index + 10);
	const view = createSpectrogramSampleViews([samples], clip, { project, sourceFrameOffset: 10 })[0]!;

	assert.equal(view.length, 3);
	assert.deepEqual([0, 1, 2].map((index) => view.sampleAt(index)), [10, 11, 14]);
	assert.equal(view.sampleAt(3), 0);
});

test('spectrogram sample views preserve the full PCM interval beyond waveform preview caps', () => {
	const samples = Float32Array.from({ length: 10_000 }, (_, index) => index / 10_000);
	const view = createSpectrogramSampleViews([samples], {
		timelineStartFrame: 0,
		durationFrames: 10_000,
		sourceStartFrame: 0,
		sourceDurationFrames: 10_000,
		waveformStartFrame: 0,
		waveformEndFrame: 10_000,
	}, {})[0]!;

	assert.equal(view.length, 10_000);
	assert.equal(view.sampleAt(9_999), samples[9_999]);
});
