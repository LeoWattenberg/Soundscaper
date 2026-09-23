/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	frequencyWaveformColor,
	prepareFrequencyWaveformProjection,
} from '../src/common/editor/ui/timeline/frequency-waveform-projection.ts';
import {
	FREQUENCY_WAVEFORM_FFT_SIZE,
	FREQUENCY_WAVEFORM_HOP_SIZE,
	frequencyWaveformBlockSizes,
} from '../src/common/editor/frequency-waveform-contract.ts';
import type {
	SummaryWaveformChannel,
	WaveformRendering,
} from '../src/common/editor/design-system-adapters/types.ts';

function channel(values: readonly number[]) {
	return {
		minimums: Float32Array.from(values, (value) => -value),
		maximums: Float32Array.from(values),
	};
}

function analysis(frameCount = 1_024) {
	const blockSizes = frequencyWaveformBlockSizes(frameCount, 1);
	return {
		version: 1,
		sampleRate: 48_000,
		frameCount,
		channelCount: 1,
		visualChannelCount: 1,
		crossovers: { lowMidHz: 250, midHighHz: 4_000 },
		fftSize: FREQUENCY_WAVEFORM_FFT_SIZE,
		hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
		levels: blockSizes.map((blockSize) => {
			const bucketCount = Math.ceil(frameCount / blockSize);
			const values = Array.from({ length: bucketCount }, (_, index) => index + 1);
			return {
			blockSize,
			bands: {
				low: [channel(values)],
				mid: [channel(values.map((value) => value * 2))],
				high: [channel(values.map((value) => value * 3))],
			},
			centroid: {
				numerators: Float32Array.from(values, (weight, index) => (index + 1) * 100 * weight),
				weights: Float32Array.from(values),
			},
		};
		}),
	};
}

function clip(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		id: 'clip',
		sourceId: 'source',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 1_024,
		durationFrames: 4,
		waveformStartFrame: 0,
		waveformEndFrame: 4,
		gain: 1,
		fadeInFrames: 0,
		fadeOutFrames: 0,
		reversed: false,
		inverted: false,
		...overrides,
	};
}

test('frequency projection creates three aligned band plans and centroid columns', () => {
	const projection = prepareFrequencyWaveformProjection(analysis(), clip(), {
		startFrame: 0,
		endFrame: 4,
		pixelWidth: 4,
	});

	assert.equal(projection.peakBlockSize, 256);
	assert.deepEqual([...summaryChannel(projection.bands.low).minimum], [-1, -2, -3, -4]);
	assert.deepEqual([...summaryChannel(projection.bands.mid).maximum], [2, 4, 6, 8]);
	assert.deepEqual([...summaryChannel(projection.bands.high).maximum], [3, 6, 9, 12]);
	assert.deepEqual([...projection.centroidHz], [100, 200, 300, 400]);
	assert.deepEqual([...projection.centroidWeight], [1, 2, 3, 4]);
});

test('frequency projection follows reverse, stretch, gain, fades, and inversion', () => {
	const projection = prepareFrequencyWaveformProjection(analysis(), clip({
		durationFrames: 8,
		waveformEndFrame: 8,
		reversed: true,
		inverted: true,
		gain: 2,
		fadeInFrames: 4,
	}), {
		startFrame: 0,
		endFrame: 8,
		pixelWidth: 4,
	});

	const low = summaryChannel(projection.bands.low);
	assert.deepEqual([...low.minimum], [-4, -6, -4, -2]);
	assert.deepEqual([...low.maximum], [4, 6, 4, 2]);
	assert.deepEqual([...projection.centroidHz], [400, 300, 200, 100]);
	assert.equal(projection.centroidWeight[0], 4);
	assert.equal(projection.centroidWeight[3], 2);
});

test('frequency projection aggregates source buckets for a trimmed stretched clip', () => {
	const sourceAnalysis = analysis(2_048);
	const projection = prepareFrequencyWaveformProjection(sourceAnalysis, clip({
		sourceStartFrame: 512,
		sourceDurationFrames: 1_024,
		durationFrames: 8,
		waveformStartFrame: 2,
		waveformEndFrame: 6,
	}), {
		startFrame: 2,
		endFrame: 6,
		pixelWidth: 2,
	});

	assert.deepEqual([...summaryChannel(projection.bands.low).maximum], [4, 5]);
	assert.deepEqual([...projection.centroidHz], [400, 500]);
});

test('frequency projection follows the shared nonlinear audio-warp mapping', () => {
	const project = {
		sampleRate: 48_000,
		tempoMap: {
			mode: 'musical' as const,
			events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
	};
	const projection = prepareFrequencyWaveformProjection(analysis(), clip({
		durationFrames: 1_024,
		waveformEndFrame: 1_024,
		kind: 'audio',
		anchor: 'sample',
		warpMap: {
			feature: 'audio-warp' as const,
			points: [
				{ outer: 0, source: 0, mode: 'forward' as const },
				{ outer: 512, source: 256, mode: 'forward' as const },
				{ outer: 1_024, source: 1_024, mode: 'forward' as const },
			],
		},
	}), {
		startFrame: 0,
		endFrame: 1_024,
		pixelWidth: 4,
		project,
	});

	assert.deepEqual([...summaryChannel(projection.bands.low).maximum], [1, 1, 3, 4]);
	assert.deepEqual([...projection.centroidHz].map(Math.round), [100, 100, 260, 357]);
});

test('frequency projection uses sample-resolution bounded windows at close zoom', () => {
	const values = [0.1, 0.2, 0.3, 0.4];
	const window = {
		version: 1,
		sampleRate: 48_000,
		startFrame: 100,
		frameCount: 4,
		channelCount: 1,
		visualChannelCount: 1,
		crossovers: { lowMidHz: 250, midHighHz: 4_000 },
		bands: {
			low: [Float32Array.from(values)],
			mid: [Float32Array.from(values, (value) => -value * 2)],
			high: [Float32Array.from(values, (value) => value * 3)],
		},
		centroid: {
			firstCenterFrame: 100,
			hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
			numerators: Float32Array.of(1_000),
			weights: Float32Array.of(1),
		},
	};
	const projection = prepareFrequencyWaveformProjection(window, clip({
		sourceStartFrame: 100,
		sourceDurationFrames: 4,
	}), {
		startFrame: 0,
		endFrame: 4,
		pixelWidth: 4,
	});

	assert.equal(projection.peakBlockSize, 1);
	assert.deepEqual([...summaryChannel(projection.bands.low).maximum], [...Float32Array.from(values)]);
	assert.deepEqual(
		[...summaryChannel(projection.bands.mid).minimum],
		[...Float32Array.from([-0.2, -0.4, -0.6, -0.8])],
	);
	assert.deepEqual([...projection.centroidHz], [1_000, 1_000, 1_000, 1_000]);
});

test('a short bounded window uses the preceding FFT center for rainbow color', () => {
	const window = {
		version: 1,
		sampleRate: 48_000,
		startFrame: 100,
		frameCount: 4,
		channelCount: 1,
		visualChannelCount: 1,
		crossovers: { lowMidHz: 250, midHighHz: 4_000 },
		bands: {
			low: [Float32Array.of(0.1, 0.2, 0.3, 0.4)],
			mid: [new Float32Array(4)],
			high: [new Float32Array(4)],
		},
		centroid: {
			firstCenterFrame: 0,
			hopSize: FREQUENCY_WAVEFORM_HOP_SIZE,
			numerators: Float32Array.of(1_000),
			weights: Float32Array.of(1),
		},
	};
	const projection = prepareFrequencyWaveformProjection(window, clip({
		sourceStartFrame: 100,
		sourceDurationFrames: 4,
	}), { startFrame: 0, endFrame: 4, pixelWidth: 4 });

	assert.deepEqual(
		[...summaryChannel(projection.bands.low).maximum],
		[...window.bands.low[0]],
	);
	assert.deepEqual([...projection.centroidHz], [1_000, 1_000, 1_000, 1_000]);
	assert.deepEqual([...projection.centroidWeight], [1, 1, 1, 1]);
});

test('rainbow colors use the Freesound-inspired log palette and neutral silence', () => {
	assert.equal(frequencyWaveformColor(100, 1, 48_000), 'rgb(50, 0, 200)');
	assert.equal(frequencyWaveformColor(22_050, 1, 48_000), 'rgb(255, 70, 0)');
	assert.equal(frequencyWaveformColor(1_000, 0, 48_000), 'rgb(50, 50, 50)');
	assert.match(frequencyWaveformColor(1_000, 1, 48_000), /^rgb\(\d+, \d+, \d+\)$/);
});

test('frequency projection rejects mismatched or malformed analysis data', () => {
	assert.throws(() => prepareFrequencyWaveformProjection({ ...analysis(), version: 99 }, clip(), {
		startFrame: 0,
		endFrame: 4,
		pixelWidth: 4,
	}), /version 1/);
	assert.throws(() => prepareFrequencyWaveformProjection(analysis(512), clip(), {
		startFrame: 0,
		endFrame: 4,
		pixelWidth: 4,
	}), /source frame count/);
});

function summaryChannel(rendering: WaveformRendering): SummaryWaveformChannel {
	assert.equal(rendering.mode, 'summary');
	return rendering.channels[0] as SummaryWaveformChannel;
}
