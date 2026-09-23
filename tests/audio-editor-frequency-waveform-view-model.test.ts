/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import { prepareFrequencyWaveformClipProjection } from '../src/common/editor/ui/timeline/frequency-waveform-projection.ts';
import {
	FREQUENCY_WAVEFORM_FFT_SIZE,
	FREQUENCY_WAVEFORM_HOP_SIZE,
	frequencyWaveformBlockSizes,
} from '../src/common/editor/frequency-waveform-contract.ts';

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

test('frequency display modes attach a projected plan when analysis is ready', () => {
	const frequencyAnalysis = createFrequencyAnalysis(source.frameCount);
	const viewModel = createTimelineClipViewModel({
		...base,
		controller: {
			...controller,
			getClipVisualData: () => ({
				source,
				buffer,
				pcmWindow: null,
				peaks: null,
				frequencyAnalysis,
			}),
		},
		rendering: {
			...base.rendering,
			frequencyWaveformMode: 'waveform-rainbow',
			frequencyWaveformProjector: prepareFrequencyWaveformClipProjection,
		},
	});

	assert.ok(viewModel.audacityWaveform);
	assert.ok(viewModel.frequencyWaveform);
	assert.equal(viewModel.frequencyWaveform.sampleRate, source.sampleRate);
	assert.equal(viewModel.frequencyWaveform.bands.low.channels.length, 1);
});

test('moderate summary zoom prefers a bounded frequency window over a 256-frame pyramid', () => {
	const frameCount = 25_600;
	const moderateSource = { ...source, frameCount };
	const moderateClip = {
		...clip,
		sourceDurationFrames: frameCount,
		durationFrames: frameCount,
		waveformEndFrame: frameCount,
	};
	const frequencyAnalysis = createFrequencyAnalysis(frameCount);
	const frequencyWindow = createFrequencyWindow(frameCount);
	const moderateBuffer = {
		numberOfChannels: 1,
		getChannelData: () => new Float32Array(frameCount),
	};
	const viewModel = createTimelineClipViewModel({
		...base,
		clip: moderateClip,
		sourceLookup: new Map([[moderateSource.id, moderateSource]]),
		geometry: { ...base.geometry, pixelsPerSecond: 480 },
		controller: {
			...controller,
			getClipVisualData: () => ({
				source: moderateSource,
				buffer: moderateBuffer,
				pcmWindow: null,
				peaks: null,
				frequencyAnalysis,
				frequencyWindow,
			}),
		},
		rendering: {
			...base.rendering,
			frequencyWaveformMode: 'waveform-rainbow',
			frequencyWaveformProjector: prepareFrequencyWaveformClipProjection,
		},
	});

	assert.equal(frameCount / (frameCount / 48_000 * 480), 100);
	assert.equal(viewModel.frequencyWaveform?.peakBlockSize, 1);
});

test('adaptive full-analysis geometry selects a matching window while crossovers refresh', () => {
	const frameCount = 30_000;
	const adaptiveSource = { ...source, frameCount: 40_000_000 };
	const adaptiveClip = {
		...clip,
		sourceDurationFrames: frameCount,
		durationFrames: frameCount,
		waveformEndFrame: frameCount,
	};
	const frequencyWindow = createFrequencyWindow(frameCount);
	const viewModel = createTimelineClipViewModel({
		...base,
		clip: adaptiveClip,
		sourceLookup: new Map([[adaptiveSource.id, adaptiveSource]]),
		geometry: { ...base.geometry, pixelsPerSecond: 160 },
		controller: {
			...controller,
			getClipVisualData: () => ({
				source: adaptiveSource,
				buffer: { numberOfChannels: 1, getChannelData: () => new Float32Array(frameCount) },
				pcmWindow: null,
				peaks: null,
				frequencyAnalysis: {
					crossovers: { lowMidHz: 300, midHighHz: 5_000 },
					levels: [{ blockSize: 512 }],
				},
				frequencyWindow,
			}),
		},
		rendering: {
			...base.rendering,
			frequencyWaveformMode: 'waveform-rainbow',
			frequencyWaveformProjector: prepareFrequencyWaveformClipProjection,
		},
	});

	assert.equal(frameCount / (frameCount / 48_000 * 160), 300);
	assert.equal(viewModel.frequencyWaveform?.peakBlockSize, 1);
});

test('frequency display modes retain the ordinary waveform while analysis is unavailable', () => {
	const viewModel = createTimelineClipViewModel({
		...base,
		rendering: { ...base.rendering, frequencyWaveformMode: 'waveform-three-band' },
	});

	assert.ok(viewModel.audacityWaveform);
	assert.equal(viewModel.frequencyWaveform, undefined);
});

test('a completed frequency analysis invalidates the ordinary fallback cache entry', () => {
	const cache = new Map();
	const rendering = {
		...base.rendering,
		frequencyWaveformMode: 'waveform-three-band' as const,
		frequencyWaveformProjector: prepareFrequencyWaveformClipProjection,
	};
	const fallback = createTimelineClipViewModel({ ...base, rendering, cache });
	const ready = createTimelineClipViewModel({
		...base,
		rendering,
		cache,
		controller: {
			...controller,
			getClipVisualData: () => ({
				source,
				buffer,
				pcmWindow: null,
				peaks: null,
				frequencyAnalysis: createFrequencyAnalysis(source.frameCount),
			}),
		},
	});

	assert.equal(fallback.frequencyWaveform, undefined);
	assert.ok(ready.frequencyWaveform);
	assert.notEqual(ready.audacityWaveform, fallback.audacityWaveform);
});

test('loading the lazy frequency projector replaces a cached ordinary fallback', () => {
	const cache = new Map();
	const frequencyAnalysis = createFrequencyAnalysis(source.frameCount);
	const frequencyController = {
		...controller,
		getClipVisualData: () => ({
			source,
			buffer,
			pcmWindow: null,
			peaks: null,
			frequencyAnalysis,
		}),
	};
	const rendering = {
		...base.rendering,
		frequencyWaveformMode: 'waveform-rainbow' as const,
	};
	const fallback = createTimelineClipViewModel({
		...base,
		controller: frequencyController,
		rendering,
		cache,
	});
	const ready = createTimelineClipViewModel({
		...base,
		controller: frequencyController,
		rendering: { ...rendering, frequencyWaveformProjector: prepareFrequencyWaveformClipProjection },
		cache,
	});

	assert.equal(fallback.frequencyWaveform, undefined);
	assert.ok(ready.frequencyWaveform);
});

test('changed crossover preferences never reuse stale full or bounded frequency data', () => {
	const frequencyAnalysis = createFrequencyAnalysis(source.frameCount);
	const staleWindow = {
		...frequencyAnalysis,
		startFrame: 0,
		frameCount: source.frameCount,
	};
	const viewModel = createTimelineClipViewModel({
		...base,
		controller: {
			...controller,
			getClipVisualData: () => ({
				source,
				buffer,
				pcmWindow: null,
				peaks: null,
				frequencyAnalysis,
				frequencyWindow: staleWindow,
			}),
		},
		rendering: {
			...base.rendering,
			frequencyWaveformMode: 'waveform-three-band',
			frequencyWaveformProjector: prepareFrequencyWaveformClipProjection,
			frequencyWaveformPreferences: {
				lowMidCrossoverHz: 300,
				midHighCrossoverHz: 5_000,
			},
		},
	});

	assert.ok(viewModel.audacityWaveform);
	assert.equal(viewModel.frequencyWaveform, undefined);
});

function createFrequencyAnalysis(frameCount: number) {
	return {
		version: 1 as const,
		sampleRate: 48_000,
		frameCount,
		channelCount: 1,
		visualChannelCount: 1,
		crossovers: { lowMidHz: 250, midHighHz: 4_000 },
		fftSize: FREQUENCY_WAVEFORM_FFT_SIZE,
		hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
		levels: frequencyWaveformBlockSizes(frameCount, 1).map((blockSize) => {
			const length = Math.ceil(frameCount / blockSize);
			const band = [{
				minimums: new Float32Array(length).fill(-0.5),
				maximums: new Float32Array(length).fill(0.5),
			}];
			return {
				blockSize,
				bands: { low: band, mid: band, high: band },
				centroid: {
					numerators: new Float32Array(length).fill(1_000),
					weights: new Float32Array(length).fill(1),
				},
			};
		}),
	};
}

function createFrequencyWindow(frameCount: number) {
	const channel = () => new Float32Array(frameCount).fill(0.25);
	const centroidLength = Math.ceil(frameCount / FREQUENCY_WAVEFORM_HOP_SIZE);
	return {
		version: 1 as const,
		sampleRate: 48_000,
		startFrame: 0,
		frameCount,
		channelCount: 1,
		visualChannelCount: 1,
		crossovers: { lowMidHz: 250, midHighHz: 4_000 },
		bands: { low: [channel()], mid: [channel()], high: [channel()] },
		centroid: {
			firstCenterFrame: 0,
			hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
			numerators: new Float32Array(centroidLength).fill(1_000),
			weights: new Float32Array(centroidLength).fill(1),
		},
	};
}

test('three-band sample zoom skips frequency projection and keeps exact ordinary samples', () => {
	let projections = 0;
	const viewModel = createTimelineClipViewModel({
		...base,
		geometry: { ...base.geometry, pixelsPerSecond: 96_000 },
		rendering: {
			...base.rendering,
			frequencyWaveformMode: 'waveform-three-band',
			frequencyWaveformProjector: (...args) => {
				projections += 1;
				return prepareFrequencyWaveformClipProjection(...args);
			},
		},
	});
	assert.equal(projections, 0);
	assert.equal((viewModel.audacityWaveform as { mode: string }).mode, 'connecting-dots');
	assert.equal(viewModel.frequencyWaveform, undefined);
});
