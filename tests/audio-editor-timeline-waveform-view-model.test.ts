/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTimelineClipViewModel } from '../src/common/editor/ui/timeline/waveform-view-model.ts';
import {
	pcmWindowCoversProjectedClip,
	peakWindowCoversProjectedClip,
} from '../src/common/editor/ui/timeline/preview.ts';
import { WAVEFORM_PEAKS_VERSION } from '../src/common/editor/waveform-peak-contract.ts';

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
function peakPyramid(blockSize: number) {
	const buckets = Math.ceil(source.frameCount / blockSize);
	return {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{
			blockSize,
			channels: [{
				minimums: new Float32Array(buckets).fill(-0.5),
				maximums: new Float32Array(buckets).fill(0.5),
				rms: new Float32Array(buckets).fill(0.25),
			}],
		}],
	};
}
const controller = {
	getClipVisualData: () => ({ source, buffer, pcmWindow: null, peaks: null }),
	getProjectBinClipVisualData: () => null,
};

test('projected windows from a replaced source do not cover the new clip', () => {
	const staleWindow = {
		sourceId: 'old-source',
		startFrame: 0,
		endFrame: 100,
		blockSize: 1,
		channels: [new Float32Array(100)],
	};
	assert.equal(pcmWindowCoversProjectedClip(staleWindow, clip, null), false);
	assert.equal(peakWindowCoversProjectedClip(staleWindow, clip, null, 48), false);
});
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

test('timeline labels keep stable clip titles after rendered sources receive derived names', () => {
	assert.equal(timelineName('Recording', 'Recording.wav'), 'Recording.wav');
	assert.equal(timelineName('Recording', 'Recording — Invert.wav'), 'Recording');
	assert.equal(timelineName('Audio clip', 'Audio clip — Tremolo.wav'), 'Audio clip');
	assert.equal(timelineName('Mix', 'Mix — Mix and render.wav'), 'Mix');
});

test('the clip projection carries the pitch shift the header badge is drawn from', () => {
	assert.equal(createTimelineClipViewModel(base).pitchCents, 0);
	assert.equal(createTimelineClipViewModel({ ...base, clip: { ...clip, pitchCents: -200 } }).pitchCents, -200);
	// A project written before clips stored a shift leaves the field absent,
	// and the badge must read that as an unshifted clip rather than as NaN.
	assert.equal(createTimelineClipViewModel({
		...base,
		clip: { ...clip, pitchCents: undefined },
	}).pitchCents, 0);
});

test('warped clip projection consumes its warp-fetched partial PCM window', () => {
	const project = {
		sampleRate: 48_000,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const warpedClip = {
		...clip,
		kind: 'audio',
		anchor: 'sample',
		waveformEndFrame: 50,
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 0, mode: 'forward' as const },
				{ outer: 50, source: 10, mode: 'forward' as const },
				{ outer: 100, source: 100, mode: 'forward' as const },
			],
		},
	};
	const pcmWindow = {
		channels: [Float32Array.from({ length: 12 }, (_, index) => index / 12)],
		startFrame: 0,
		endFrame: 12,
	};
	const viewModel = createTimelineClipViewModel({
		...base,
		project,
		clip: warpedClip,
		controller: {
			...controller,
			getClipVisualData: () => ({ source, buffer: null, pcmWindow, peaks: null }),
		},
	});

	assert.ok(viewModel.audacityWaveform);
	assert.equal(viewModel.waveformError, undefined);
});

test('warped clips retain their last waveform while a locally finer window is pending', () => {
	const project = {
		sampleRate: 48_000,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const warpedClip = {
		...clip,
		kind: 'audio',
		anchor: 'sample',
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 0, mode: 'forward' as const },
				{ outer: 50, source: 10, mode: 'forward' as const },
				{ outer: 100, source: 100, mode: 'forward' as const },
			],
		},
	};
	const options = {
		...base,
		project,
		clip: warpedClip,
		controller: {
			...controller,
			getClipVisualData: () => ({ source, buffer: null, pcmWindow: null, peaks: peakPyramid(1) }),
		},
	};
	const viewModel = createTimelineClipViewModel(options);

	assert.equal(viewModel.audacityWaveform, undefined);
	assert.equal(viewModel.waveformPending, true);
	assert.equal(viewModel.waveformError, undefined);
	const firstPaint = createTimelineClipViewModel({ ...options, waveformPending: true });
	const preview = firstPaint.audacityWaveform as { pixelWidth: number; peakBlockSize: number };
	assert.ok(preview, 'a newly visible warped clip has a coarse outline while disk peaks load');
	assert.ok(preview.pixelWidth < firstPaint.duration * base.geometry.pixelsPerSecond);
	assert.equal(firstPaint.waveformPending, true);
});

test('warped clips use a fine local window when a global level only meets the average resolution', () => {
	const warpedSource = { ...source, frameCount: 1_000 };
	const warpedClip = {
		...clip,
		kind: 'audio',
		anchor: 'sample',
		sourceDurationFrames: 1_000,
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 0, mode: 'forward' as const },
				{ outer: 50, source: 150, mode: 'forward' as const },
				{ outer: 100, source: 1_000, mode: 'forward' as const },
			],
		},
	};
	const channel = (buckets: number) => ({
		minimums: new Float32Array(buckets).fill(-0.5),
		maximums: new Float32Array(buckets).fill(0.5),
		rms: new Float32Array(buckets).fill(0.25),
	});
	const peaks = {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{ blockSize: 8, channels: [channel(125)] }],
	};
	const peakWindow = {
		startFrame: 0,
		endFrame: 1_000,
		blockSize: 2,
		channels: [channel(500)],
	};
	const warpProject = {
		sampleRate: 48_000,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const viewModel = createTimelineClipViewModel({
		...base,
		project: warpProject,
		geometry: { overscanStartFrame: 0, pixelsPerSecond: 48_000, sampleRate: 48_000 },
		clip: warpedClip,
		sourceLookup: new Map([[warpedSource.id, warpedSource]]),
		controller: {
			...controller,
			getClipVisualData: () => ({
				source: warpedSource,
				buffer: null,
				pcmWindow: null,
				peaks,
				peakWindow,
			}),
		},
	});

	assert.equal(viewModel.waveformError, undefined);
	assert.equal(viewModel.waveformPending, undefined);
	assert.equal((viewModel.audacityWaveform as { peakBlockSize: number }).peakBlockSize, 2);
});

test('timeline waveforms use PCM before a peak bucket would exceed one pixel', () => {
	const viewModel = createTimelineClipViewModel({
		...base,
		controller: {
			...controller,
			getClipVisualData: () => ({
				source,
				buffer,
				pcmWindow: null,
				peaks: peakPyramid(8),
			}),
		},
	});
	const rendering = viewModel.audacityWaveform as { peakBlockSize?: number; pixelsPerSample: number };
	assert.equal(rendering.peakBlockSize, undefined);
	assert.equal(rendering.pixelsPerSample, 0.48);
});

test('an unusable persisted peak cache does not hide valid PCM', () => {
	const viewModel = createTimelineClipViewModel({
		...base,
		controller: {
			...controller,
			getClipVisualData: () => ({
				source,
				buffer,
				pcmWindow: null,
				peaks: { version: WAVEFORM_PEAKS_VERSION, channelCount: 1, levels: [] },
			}),
		},
	});
	assert.ok(viewModel.audacityWaveform);
	assert.equal(viewModel.waveformError, undefined);
});

test('timeline waveforms wait for PCM instead of displaying an over-wide peak bucket', () => {
	const viewModel = createTimelineClipViewModel({
		...base,
		controller: {
			...controller,
			getClipVisualData: () => ({
				source,
				buffer: null,
				pcmWindow: null,
				peaks: peakPyramid(8),
			}),
		},
	});
	assert.equal(viewModel.audacityWaveform, undefined);
	assert.equal(viewModel.waveformPending, true);
});

test('a newly visible disk waveform shows a thin coarse preview while fine peaks load', () => {
	const cache = new Map();
	const peaks = peakPyramid(8);
	const options = {
		...base,
		waveformPending: true,
		cache,
		controller: {
			...controller,
			getClipVisualData: () => ({
				available: true,
				source,
				buffer: null,
				pcmWindow: null,
				peaks,
			}),
		},
	};
	const viewModel = createTimelineClipViewModel(options);
	const rendering = viewModel.audacityWaveform as {
		pixelWidth: number;
		pixelsPerSample: number;
		peakBlockSize: number;
	};
	assert.ok(rendering, 'the first canvas has a plan before the disk read completes');
	assert.ok(rendering.pixelWidth < viewModel.duration * base.geometry.pixelsPerSecond);
	assert.ok(rendering.peakBlockSize * rendering.pixelsPerSample <= 1);
	assert.equal(viewModel.waveformPending, true);
	assert.equal(createTimelineClipViewModel(options).waveformPending, true);
});

test('disk-backed waveforms retain their previous canvas while their render-planned window is pending', () => {
	const viewModel = createTimelineClipViewModel({
		...base,
		waveformPending: true,
		controller: {
			...controller,
			getClipVisualData: () => ({
				available: true,
				source,
				buffer: null,
				pcmWindow: null,
				peaks: null,
			}),
		},
	});
	assert.equal(viewModel.audacityWaveform, undefined);
	assert.equal(viewModel.waveformPending, true);
});

test('timeline waveforms use a viewport-local peak window when raw PCM would be too large', () => {
	const peakWindow = {
		startFrame: 0,
		endFrame: 100,
		blockSize: 2,
		pixelsPerSample: 0.48,
		channels: [{
			minimums: new Float32Array(50).fill(-0.25),
			maximums: new Float32Array(50).fill(0.25),
			rms: new Float32Array(50).fill(0.125),
		}],
	};
	const viewModel = createTimelineClipViewModel({
		...base,
		controller: {
			...controller,
			getClipVisualData: () => ({
				source,
				buffer: null,
				pcmWindow: null,
				peakWindow,
				peaks: peakPyramid(8),
			}),
		},
	});
	const rendering = viewModel.audacityWaveform as { peakBlockSize: number; pixelsPerSample: number };
	assert.equal(rendering.peakBlockSize, 2);
	assert.ok(rendering.peakBlockSize * rendering.pixelsPerSample <= 1);
	assert.equal(viewModel.waveformPending, undefined);
});

test('a prefetched local peak window does not offset the selected persisted pyramid', () => {
	const globalMinimums = new Float32Array(200).fill(-0.25);
	globalMinimums.fill(-1, 0, 20);
	const globalPeaks = {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{
			blockSize: 1,
			channels: [{
				minimums: globalMinimums,
				maximums: new Float32Array(200).fill(0.25),
				rms: new Float32Array(200).fill(0.125),
			}],
		}],
	};
	const peakWindow = {
		startFrame: 20,
		endFrame: 120,
		blockSize: 2,
		pixelsPerSample: 0.0025,
		channels: [{
			minimums: new Float32Array(50).fill(-0.5),
			maximums: new Float32Array(50).fill(0.5),
			rms: new Float32Array(50).fill(0.25),
		}],
	};
	const largerSource = { ...source, frameCount: 200 };
	const viewModel = createTimelineClipViewModel({
		...base,
		clip: { ...clip, sourceStartFrame: 20 },
		sourceLookup: new Map([[largerSource.id, largerSource]]),
		controller: {
			...controller,
			getClipVisualData: () => ({
				source: largerSource,
				buffer: null,
				pcmWindow: null,
				peakWindow,
				peaks: globalPeaks,
			}),
		},
	});
	const rendering = viewModel.audacityWaveform as {
		peakBlockSize: number;
		channels: readonly { minimum: Float32Array }[];
	};
	assert.equal(rendering.peakBlockSize, 1);
	assert.equal(rendering.channels[0]?.minimum[0], -0.25);
});

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

test('a drag preview cannot reuse waveform pixels from a replaced source', () => {
	const cache = new Map();
	const initial = createTimelineClipViewModel({ ...base, cache });
	const replacement = { ...source, id: 'replacement-source' };
	const changed = createTimelineClipViewModel({
		...base,
		clip: { ...clip, sourceId: replacement.id },
		controller: {
			...controller,
			getClipVisualData: () => ({ source: replacement, buffer, pcmWindow: null, peaks: null }),
		},
		sourceLookup: new Map([[replacement.id, replacement]]),
		cache,
		reuseCachedWaveform: true,
	});
	assert.notEqual(changed.audacityWaveform, initial.audacityWaveform);
	assert.equal((changed.audacityWaveform as { sourceId: string }).sourceId, replacement.id);
});

test('drag preview does not reuse a peak plan after zoom makes its buckets too wide', () => {
	const cache = new Map();
	const peakController = {
		...controller,
		getClipVisualData: () => ({ source, buffer: null, pcmWindow: null, peaks: peakPyramid(1) }),
	};
	const initial = createTimelineClipViewModel({
		...base,
		controller: peakController,
		geometry: { overscanStartFrame: 0, pixelsPerSecond: 12_000, sampleRate: 48_000 },
		cache,
	});
	assert.equal((initial.audacityWaveform as { peakBlockSize: number }).peakBlockSize, 1);
	const zoomed = createTimelineClipViewModel({
		...base,
		controller: peakController,
		geometry: { overscanStartFrame: 0, pixelsPerSecond: 96_000, sampleRate: 48_000 },
		cache,
		reuseCachedWaveform: true,
	});
	assert.equal(zoomed.audacityWaveform, undefined);
	assert.equal(zoomed.waveformPending, true);
});

function timelineName(title: string, sourceName: string): string {
	const namedSource = { ...source, name: sourceName };
	return createTimelineClipViewModel({
		...base,
		clip: { ...clip, title },
		sourceLookup: new Map([[namedSource.id, namedSource]]),
		controller: {
			...controller,
			getClipVisualData: () => ({ source: namedSource, buffer, pcmWindow: null, peaks: null }),
		},
	}).name;
}
