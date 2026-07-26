/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';

const source = {
	id: 'source', storageKey: 'source', revision: 1, name: 'Source',
	sampleRate: 48_000, frameCount: 100, channelCount: 1,
};
const clip = {
	id: 'clip', sourceId: source.id, title: 'Clip', timelineStartFrame: 0,
	sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
	waveformStartFrame: 0, waveformEndFrame: 100, gain: 1,
	fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
	envelope: [{ frame: 0, value: 1 }],
};
const samples = new Float32Array(100).map((_, index) => Math.sin(index / 10));
const buffer = {
	numberOfChannels: 1,
	getChannelData: () => samples,
};
const controller = {
	getClipVisualData: () => ({ source, buffer, pcmWindow: null, peaks: null }),
	getProjectBinClipVisualData: () => null,
};
const base = {
	controller,
	sourceLookup: new Map([[source.id, source]]),
	clip,
	geometry: { overscanStartFrame: 0, pixelsPerSecond: 120, sampleRate: 48_000 },
	selection: { selectedClipIds: null },
	copy: { clip: 'Clip' },
	rendering: {
		showRms: false,
		halfWave: false,
		color: 'blue',
		reuseSummaryForCompatibility: false,
		allowPeakPyramid: true,
		provideAudacitySpectrogram: false,
	},
} as const;

test('timeline waveform plans survive equivalent snapshots and drag previews, then refresh after commit', () => {
	const cache = new Map();
	const initial = createTimelineClipViewModel({ ...base, cache });
	const cloned = createTimelineClipViewModel({
		...base,
		clip: { ...clip, envelope: clip.envelope.map((point) => ({ ...point })) },
		cache,
	});
	assert.equal(cloned.audacityWaveform, initial.audacityWaveform);

	const dragged = createTimelineClipViewModel({
		...base,
		clip: { ...clip, timelineStartFrame: 50 },
		cache,
		reuseCachedWaveform: true,
	});
	assert.equal(dragged.audacityWaveform, initial.audacityWaveform);

	const committed = createTimelineClipViewModel({
		...base,
		clip: { ...clip, timelineStartFrame: 50 },
		cache,
	});
	assert.notEqual(committed.audacityWaveform, initial.audacityWaveform);
});
