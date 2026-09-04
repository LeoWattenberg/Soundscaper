import test from 'node:test';
import assert from 'node:assert/strict';

import {
	prepareBoundedWaveformWindow,
	preparePeakPyramidWaveformWindow,
} from '../src/common/editor/design-system-adapters.js';
import { WAVEFORM_PEAKS_VERSION } from '../src/common/editor/waveform-peak-contract.ts';


function clip(options = {}) {
	return {
		id: options.id || 'clip',
		sourceId: 'source',
		timelineStartFrame: options.timelineStartFrame ?? 0,
		sourceStartFrame: options.sourceStartFrame ?? 0,
		durationFrames: options.durationFrames ?? 48_000,
		...(options.sourceDurationFrames == null ? {} : { sourceDurationFrames: options.sourceDurationFrames }),
		gain: options.gain ?? 1,
		fadeInFrames: options.fadeInFrames ?? 0,
		fadeOutFrames: options.fadeOutFrames ?? 0,
		reversed: options.reversed ?? false,
	};
}

/**
 * Drawing a clip's waveform without reading its PCM twice.
 *
 * A waveform is drawn far more often than a clip is edited, so the adapters read from a
 * bounded window or a peak pyramid rather than the source, and every transform the clip
 * carries — gain, fades, reversal, stretch, a source offset — has to be applied to what is
 * drawn without ever altering the source it came from. These check exactly that, at each
 * of the two levels the renderer can read from.
 *
 * `tests/audio-editor-design-system-adapters.test.js` covers the value and viewport
 * adapters the same surfaces use.
 */

test('bounded waveform preprocessing applies linear gain and fades without changing source PCM', () => {
	const source = Float32Array.of(1, 1, 1, 1, 1);
	const result = prepareBoundedWaveformWindow([source], clip({
		durationFrames: 5,
		gain: 2,
		fadeInFrames: 2,
		fadeOutFrames: 2,
	}), { maxSamples: 10 });

	assert.deepEqual([...source], [1, 1, 1, 1, 1]);
	assert.deepEqual([...result.channels[0]], [0, 1, 2, 2, 1]);
	assert.deepEqual({ ...result, channels: undefined }, {
		channels: undefined,
		startFrame: 0,
		endFrame: 5,
		frameCount: 5,
		sampleCount: 5,
		framesPerBucket: 1,
		downsampled: false,
	});
});

test('bounded waveform preprocessing handles source offsets, stereo windows, and reversal', () => {
	const left = Float32Array.of(99, 1, 2, 3, 4, 88);
	const right = Float32Array.of(99, 10, 20, 30, 40, 88);
	const result = prepareBoundedWaveformWindow([left, right], clip({
		sourceStartFrame: 1,
		durationFrames: 4,
		reversed: true,
	}), { startFrame: 1, endFrame: 3, maxSamples: 10 });

	assert.deepEqual([...result.channels[0]], [3, 2]);
	assert.deepEqual([...result.channels[1]], [30, 20]);
	assert.equal(result.startFrame, 1);
	assert.equal(result.endFrame, 3);
	assert.equal(result.frameCount, 2);
});

test('bounded waveform preprocessing reads a demand-loaded PCM source window', () => {
	const window = Float32Array.of(2, 3, 4, 5, 6, 7);
	const sourceClip = clip({
		sourceStartFrame: 100,
		durationFrames: 8,
	});
	const forward = prepareBoundedWaveformWindow([window], sourceClip, {
		startFrame: 2,
		endFrame: 6,
		maxSamples: 8,
		pixelWidth: 8,
		sourceFrameOffset: 102,
	});
	assert.deepEqual([...forward.channels[0]], [2, 3, 4, 5]);
	assert.equal(forward.rendering.mode, 'connecting-dots');
	assert.deepEqual([...forward.rendering.channels[0].samples], [2, 3, 4, 5, 6]);

	const reversed = prepareBoundedWaveformWindow([window], { ...sourceClip, reversed: true }, {
		startFrame: 2,
		endFrame: 6,
		maxSamples: 8,
		sourceFrameOffset: 102,
	});
	assert.deepEqual([...reversed.channels[0]], [5, 4, 3, 2]);
	assert.throws(() => prepareBoundedWaveformWindow([window], sourceClip, {
		startFrame: 0,
		endFrame: 6,
		sourceFrameOffset: 102,
	}), /requested clip window/);
});

test('an inverted clip draws its waveform mirrored about the zero line', () => {
	const window = Float32Array.of(2, 3, 4, 5, 6, 7);
	const sourceClip = clip({ sourceStartFrame: 100, durationFrames: 8 });
	const inverted = prepareBoundedWaveformWindow([window], { ...sourceClip, inverted: true }, {
		startFrame: 2,
		endFrame: 6,
		maxSamples: 8,
		pixelWidth: 8,
		sourceFrameOffset: 102,
	});
	assert.deepEqual([...inverted.channels[0]], [-2, -3, -4, -5]);
	assert.deepEqual([...inverted.rendering.channels[0].samples], [-2, -3, -4, -5, -6]);
});

test('bounded waveform preprocessing maps stretched timeline frames onto source frames', () => {
	const source = Float32Array.of(1, 2, 3, 4);
	const result = prepareBoundedWaveformWindow([source], clip({
		durationFrames: 8,
		sourceDurationFrames: 4,
	}), { maxSamples: 16 });
	assert.deepEqual([...result.channels[0]], [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('bounded waveform downsampling retains ordered bucket extrema within the sample cap', () => {
	const source = Float32Array.of(
		0, -4, 2, 1,
		3, 2, -2, 1,
		-1, 5, 2, 0,
		4, -3, 1, 2,
	);
	const result = prepareBoundedWaveformWindow([source], clip({ durationFrames: source.length }), {
		maxSamples: 8,
	});
	assert.equal(result.downsampled, true);
	assert.equal(result.sampleCount, 8);
	assert.equal(result.channels[0].length, 8);
	assert.deepEqual([...result.channels[0]], [-4, 2, 3, -2, -1, 5, 4, -3]);
	assert.equal(result.framesPerBucket, 4);

	const single = prepareBoundedWaveformWindow([source], clip({ durationFrames: source.length }), {
		maxSamples: 1,
	});
	assert.deepEqual([...single.channels[0]], [5]);
	assert.equal(single.sampleCount, 1);
});

test('bounded waveform preprocessing clamps windows and validates channel/source geometry', () => {
	const source = Float32Array.of(1, 2, 3, 4);
	const empty = prepareBoundedWaveformWindow([source], clip({ durationFrames: 4 }), {
		startFrame: 100,
		endFrame: 100,
	});
	assert.equal(empty.frameCount, 0);
	assert.equal(empty.channels[0].length, 0);
	assert.throws(() => prepareBoundedWaveformWindow([], clip({ durationFrames: 1 })), /at least one channel/);
	assert.throws(() => prepareBoundedWaveformWindow([
		Float32Array.of(1), Float32Array.of(1, 2),
	], clip({ durationFrames: 1 })), /equally sized/);
	assert.throws(() => prepareBoundedWaveformWindow([source], clip({
		sourceStartFrame: 2,
		durationFrames: 3,
	})), /exceeds the supplied source/);
	assert.throws(() => prepareBoundedWaveformWindow([source], clip({ durationFrames: 4 }), {
		startFrame: 3,
		endFrame: 2,
	}), /endFrame/);
	assert.throws(() => prepareBoundedWaveformWindow([source], clip({ durationFrames: 4 }), {
		maxSamples: 0,
	}), /maxSamples/);
});

test('peak-pyramid waveform rendering selects the finest bounded viewport level without source PCM', () => {
	const peaks = {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 2,
		levels: [
			{
				blockSize: 8,
				channels: [1, 2].map((scale) => ({
					minimums: Float32Array.from({ length: 16 }, (_, index) => -scale * (index + 1) / 100),
					maximums: Float32Array.from({ length: 16 }, (_, index) => scale * (index + 1) / 100),
					rms: Float32Array.from({ length: 16 }, (_, index) => scale * (index + 1) / 200),
				})),
			},
			{
				blockSize: 16,
				channels: [1, 0.5].map((scale) => ({
					minimums: Float32Array.from({ length: 8 }, (_, index) => -scale * (index + 1) / 10),
					maximums: Float32Array.from({ length: 8 }, (_, index) => scale * (index + 1) / 10),
					rms: Float32Array.from({ length: 8 }, (_, index) => scale * (index + 1) / 20),
				})),
			},
			{
				blockSize: 32,
				channels: [1, 0.5].map((scale) => ({
					minimums: Float32Array.from({ length: 4 }, (_, index) => -scale * (index + 1) / 5),
					maximums: Float32Array.from({ length: 4 }, (_, index) => scale * (index + 1) / 5),
					rms: Float32Array.from({ length: 4 }, (_, index) => scale * (index + 1) / 10),
				})),
			},
			{
				blockSize: 64,
				channels: [1, 0.5].map((scale) => ({
					minimums: Float32Array.of(-0.9 * scale, -scale),
					maximums: Float32Array.of(0.9 * scale, scale),
					rms: Float32Array.of(0.45 * scale, 0.5 * scale),
				})),
			},
		],
	};
	const result = preparePeakPyramidWaveformWindow(peaks, clip({
		durationFrames: 128,
	}), {
		pixelWidth: 8,
		channelCount: 2,
		sourceFrameCount: 128,
	});

	assert.equal(result.rendering.mode, 'summary');
	assert.equal(result.rendering.peakBlockSize, 16);
	assert.equal(result.rendering.channels.length, 2);
	assert.ok(result.rendering.channels[0].rms, 'peak-only summaries retain RMS display data');
	assert.equal(result.rendering.channels[0].rms.length, result.rendering.channels[0].minimum.length);
	assert.notDeepEqual(
		[...result.rendering.channels[1].maximum],
		[...result.rendering.channels[0].maximum],
		'stereo lanes retain their independent peak summaries',
	);
	assert.notDeepEqual(
		[...result.rendering.channels[0].rms],
		[...result.rendering.channels[0].maximum],
		'RMS values remain distinct from peak extrema',
	);
	const coarser = preparePeakPyramidWaveformWindow(peaks, clip({ durationFrames: 128 }), {
		pixelWidth: 4,
		channelCount: 2,
		sourceFrameCount: 128,
	});
	assert.equal(coarser.rendering.peakBlockSize, 32);
	const zoomed = preparePeakPyramidWaveformWindow(peaks, clip({ durationFrames: 128 }), {
		pixelWidth: 128,
		channelCount: 2,
		sourceFrameCount: 128,
	});
	assert.equal(zoomed.rendering.peakBlockSize, 8);
	assert.equal(zoomed.rendering.channels[0].rms, null, 'RMS disappears at sample-level zoom');
	assert.equal(zoomed.rendering.channels[1].rms, null, 'stereo RMS uses the same zoom cutoff');
	assert.deepEqual(
		[...result.rendering.channels[0].minimum].map((value) => Math.round(value * 10) / 10),
		[-0.1, -0.2, -0.3, -0.4, -0.5, -0.6, -0.7, -0.8],
	);
	assert.deepEqual(
		[...result.rendering.channels[0].maximum].map((value) => Math.round(value * 10) / 10),
		[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
	);
	assert.deepEqual(
		[...result.rendering.channels[1].maximum].map((value) => Math.round(value * 20) / 20),
		[0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4],
	);
	assert.equal(result.channels[0].length, 16);
	assert.equal(result.channels[1].length, 16);
});

test('peak-pyramid waveform rendering maps source offsets, reverse, stretch, gain, and viewport windows', () => {
	const peaks = {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{
			blockSize: 4,
			channels: [{
				minimums: Float32Array.from({ length: 8 }, (_, index) => -(index + 1)),
				maximums: Float32Array.from({ length: 8 }, (_, index) => index + 1),
			}],
		}],
	};
	const result = preparePeakPyramidWaveformWindow(peaks, clip({
		sourceStartFrame: 8,
		sourceDurationFrames: 16,
		durationFrames: 8,
		gain: 2,
		reversed: true,
	}), {
		startFrame: 2,
		endFrame: 6,
		pixelWidth: 2,
		sourceFrameCount: 32,
	});

	assert.equal(result.rendering.peakBlockSize, 4);
	assert.equal(result.rendering.startFrame, 2);
	assert.equal(result.rendering.endFrame, 6);
	assert.deepEqual([...result.rendering.channels[0].minimum], [-10, -8]);
	assert.deepEqual([...result.rendering.channels[0].maximum], [10, 8]);
	assert.deepEqual([...result.channels[0]], [-10, 10, -8, 8]);
});

test('peak-pyramid waveform rendering swaps an inverted clip minimum and maximum', () => {
	const peaks = {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{
			blockSize: 4,
			channels: [{ minimums: Float32Array.of(-1), maximums: Float32Array.of(3) }],
		}],
	};
	const clipOptions = { sourceStartFrame: 0, sourceDurationFrames: 4, durationFrames: 4 };
	const window = { startFrame: 0, endFrame: 4, pixelWidth: 1, sourceFrameCount: 4 };
	const upright = preparePeakPyramidWaveformWindow(peaks, clip(clipOptions), window);
	assert.deepEqual([...upright.rendering.channels[0].minimum], [-1]);
	assert.deepEqual([...upright.rendering.channels[0].maximum], [3]);

	const inverted = preparePeakPyramidWaveformWindow(
		peaks,
		{ ...clip(clipOptions), inverted: true },
		window,
	);
	assert.deepEqual([...inverted.rendering.channels[0].minimum], [-3]);
	assert.deepEqual([...inverted.rendering.channels[0].maximum], [1]);
});

test('peak-pyramid waveform rendering validates cache geometry and clip source bounds', () => {
	const valid = {
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{
			blockSize: 4,
			channels: [{ minimums: Float32Array.of(-1), maximums: Float32Array.of(1) }],
		}],
	};
	assert.throws(() => preparePeakPyramidWaveformWindow({ version: WAVEFORM_PEAKS_VERSION, channelCount: 1, levels: [] }, clip({
		durationFrames: 4,
	}), { pixelWidth: 1 }), /at least one level/);
	assert.throws(() => preparePeakPyramidWaveformWindow({
		version: WAVEFORM_PEAKS_VERSION,
		channelCount: 1,
		levels: [{
			blockSize: 4,
			channels: [{
				minimums: Float32Array.of(-1),
				maximums: Float32Array.of(1, 1),
			}],
		}],
	}, clip({ durationFrames: 4 }), { pixelWidth: 1 }), /equally sized/);
	assert.throws(() => preparePeakPyramidWaveformWindow(valid, clip({
		sourceStartFrame: 2,
		durationFrames: 4,
	}), {
		pixelWidth: 1,
		sourceFrameCount: 4,
	}), /exceeds/);
});
