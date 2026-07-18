import test from 'node:test';
import assert from 'node:assert/strict';

import {
	boundedCanvasDimensions,
	createTimelineProjectIndex,
	designValueToPan,
	designValueToProgress,
	designVolumeToGainDb,
	framesToSeconds,
	gainDbToDesignVolume,
	panToDesignValue,
	prepareBoundedWaveformWindow,
	progressToDesignValue,
	projectClipsToViewport,
	rightmostVisibleClip,
	secondsToFrames,
} from '../src/lib/tools/audio-editor/design-system-adapters.js';

function closeTo(actual, expected, tolerance = 1e-10) {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

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

test('design-system time conversion rounds and clamps at canonical 48 kHz frame boundaries', () => {
	assert.equal(secondsToFrames(1), 48_000);
	assert.equal(secondsToFrames(0.5 / 48_000), 1);
	assert.equal(secondsToFrames(-100), 0);
	assert.equal(secondsToFrames(10, { minimumFrame: 100, maximumFrame: 200 }), 200);
	assert.equal(framesToSeconds(48_000), 1);
	assert.equal(framesToSeconds(1.6), 2 / 48_000);
	assert.equal(framesToSeconds(-3), 0);
	assert.equal(framesToSeconds(1, { minimumFrame: 24_000 }), 0.5);

	for (const frame of [0, 1, 47_999, 48_000, 12_345_678]) {
		assert.equal(secondsToFrames(framesToSeconds(frame)), frame);
	}
	assert.throws(() => secondsToFrames(Number.NaN), /seconds must be finite/);
	assert.throws(() => framesToSeconds(Number.POSITIVE_INFINITY), /frames must be finite/);
	assert.throws(() => secondsToFrames(0, { minimumFrame: 2, maximumFrame: 1 }), /maximumFrame/);
});

test('time and viewport adapters honor arbitrary V2 project rates', () => {
	assert.equal(secondsToFrames(1, { sampleRate: 44_100 }), 44_100);
	assert.equal(framesToSeconds(96_000, { sampleRate: 96_000 }), 1);
	const projection = projectClipsToViewport([
		clip({ timelineStartFrame: 44_100, durationFrames: 44_100 }),
	], {
		viewportStartFrame: 44_100,
		viewportDurationFrames: 44_100,
		sampleRate: 44_100,
	});
	assert.equal(projection.viewportStartSeconds, 1);
	assert.equal(projection.viewportDurationSeconds, 1);
	assert.equal(projection.clips[0].timelineStartSeconds, 1);
	assert.equal(projection.clips[0].timelineDurationSeconds, 1);
	assert.throws(() => secondsToFrames(1, { sampleRate: 0 }), /sampleRate/);
});

test('gain, pan, and progress adapters preserve their endpoints and clamp external values', () => {
	assert.equal(gainDbToDesignVolume(-60), 0);
	assert.equal(gainDbToDesignVolume(-24), 50);
	assert.equal(gainDbToDesignVolume(12), 100);
	assert.equal(gainDbToDesignVolume(-100), 0);
	assert.equal(gainDbToDesignVolume(100), 100);
	assert.equal(designVolumeToGainDb(0), -60);
	assert.equal(designVolumeToGainDb(50), -24);
	assert.equal(designVolumeToGainDb(100), 12);
	for (const gainDb of [-60, -42.75, -24, -1.25, 0, 12]) {
		closeTo(designVolumeToGainDb(gainDbToDesignVolume(gainDb)), gainDb);
	}

	assert.equal(panToDesignValue(-1), -100);
	assert.equal(panToDesignValue(0.25), 25);
	assert.equal(panToDesignValue(2), 100);
	assert.equal(designValueToPan(-200), -1);
	assert.equal(designValueToPan(75), 0.75);
	assert.equal(progressToDesignValue(-1), 0);
	assert.equal(progressToDesignValue(0.375), 37.5);
	assert.equal(progressToDesignValue(2), 100);
	assert.equal(designValueToProgress(-5), 0);
	assert.equal(designValueToProgress(25), 0.25);
	assert.equal(designValueToProgress(150), 1);
	assert.throws(() => gainDbToDesignVolume('not-a-number'), /gainDb must be finite/);
	assert.throws(() => panToDesignValue(undefined), /pan must be finite/);
	assert.throws(() => designValueToProgress(Number.NaN), /progress must be finite/);
});

test('timeline project indexing shares clip and source lookups across track projections', () => {
	const sources = [
		{ id: 'source-a', name: 'A' },
		{ id: 'source-b', name: 'B' },
	];
	const clips = [
		{ id: 'clip-a', sourceId: 'source-a' },
		{ id: 'clip-b', sourceId: 'source-b' },
		{ id: 'clip-unplaced', sourceId: 'source-a' },
	];
	const tracks = [
		{ id: 'track-a', type: 'audio', clipIds: ['clip-a', 'missing-clip'] },
		{ id: 'track-b', type: 'video', clipIds: ['clip-b'] },
		{ id: 'labels', type: 'label' },
	];

	const index = createTimelineProjectIndex({ sources, clips, tracks });

	assert.strictEqual(index.clipById.get('clip-a'), clips[0]);
	assert.strictEqual(index.sourceById.get('source-b'), sources[1]);
	assert.deepEqual(index.clipsByTrackId.get('track-a'), [clips[0]]);
	assert.deepEqual(index.clipsByTrackId.get('track-b'), [clips[1]]);
	assert.deepEqual(index.clipsByTrackId.get('labels'), []);
	assert.strictEqual(index.trackByClipId.get('clip-a'), tracks[0]);
	assert.strictEqual(index.trackByClipId.get('clip-b'), tracks[1]);
	assert.equal(index.trackByClipId.has('clip-unplaced'), false);
	assert.deepEqual(createTimelineProjectIndex(null).clipsByTrackId, new Map());
});

test('viewport projection includes one viewport of overscan and returns viewport-relative seconds', () => {
	const input = [
		clip({ id: 'outside-before', timelineStartFrame: 0, durationFrames: 48_000 }),
		clip({ id: 'overscan-before', timelineStartFrame: 24_000, durationFrames: 48_001 }),
		clip({ id: 'visible-before', timelineStartFrame: 72_000, durationFrames: 48_000 }),
		clip({ id: 'visible-after', timelineStartFrame: 120_000, durationFrames: 48_000 }),
		clip({ id: 'overscan-after', timelineStartFrame: 168_000, durationFrames: 24_001 }),
		clip({ id: 'outside-after', timelineStartFrame: 192_000, durationFrames: 48_000 }),
	];
	const original = structuredClone(input);
	const projection = projectClipsToViewport(input, {
		viewportStartFrame: 96_000,
		viewportDurationFrames: 48_000,
	});

	assert.deepEqual(input, original);
	assert.deepEqual(projection, {
		viewportStartFrame: 96_000,
		viewportEndFrame: 144_000,
		viewportDurationFrames: 48_000,
		viewportStartSeconds: 2,
		viewportDurationSeconds: 1,
		overscanStartFrame: 48_000,
		overscanEndFrame: 192_000,
		clips: projection.clips,
	});
	assert.deepEqual(projection.clips.map((item) => item.id), [
		'overscan-before', 'visible-before', 'visible-after', 'overscan-after',
	]);
	assert.deepEqual(
		projection.clips.map((item) => [
			item.id,
			item.start,
			item.duration,
			item.waveformStartFrame,
			item.waveformEndFrame,
			item.clippedAtStart,
			item.clippedAtEnd,
			item.visibleStartSeconds,
			item.visibleEndSeconds,
			item.isVisible,
		]),
		[
			['overscan-before', -1, 24_001 / 48_000, 24_000, 48_001, true, false, 0, 0, false],
			['visible-before', -0.5, 1, 0, 48_000, false, false, 0, 0.5, true],
			['visible-after', 0.5, 1, 0, 48_000, false, false, 0.5, 1, true],
			['overscan-after', 1.5, 24_000 / 48_000, 0, 24_000, false, true, 1, 1, false],
		],
	);
	assert.equal(projection.clips[1].timelineStartSeconds, 1.5);
	assert.equal(projection.clips[1].viewportStartSeconds, -0.5);
	assert.equal(projection.clips[1].viewportEndSeconds, 0.5);
	assert.equal(projection.clips[1].timelineDurationSeconds, 1);
	assert.equal(projection.clips[1].clipStartSeconds, -0.5);
	assert.equal(projection.clips[1].clipEndSeconds, 0.5);
});

test('viewport projection rejects unsafe geometry and clips ending exactly at an overscan edge', () => {
	assert.throws(() => projectClipsToViewport([], {}), /viewportDurationFrames/);
	assert.throws(() => projectClipsToViewport([], {
		viewportStartFrame: Number.MAX_SAFE_INTEGER,
		viewportDurationFrames: 1,
	}), /safe frame range/);
	assert.throws(() => projectClipsToViewport([clip({ durationFrames: 0 })], {
		viewportDurationFrames: 1,
	}), /clip.durationFrames/);

	const projection = projectClipsToViewport([
		clip({ id: 'ends-at-start', timelineStartFrame: 0, durationFrames: 48_000 }),
		clip({ id: 'starts-at-end', timelineStartFrame: 144_000, durationFrames: 1 }),
	], { viewportStartFrame: 96_000, viewportDurationFrames: 48_000 });
	assert.deepEqual(projection.clips.map((item) => item.id), ['starts-at-end']);
	assert.equal(projection.clips[0].isVisible, false);
});

test('rightmost visible clip is selected for viewport-dependent display state', () => {
	const clips = [
		{ id: 'hidden', isVisible: false, visibleStartSeconds: 0, visibleEndSeconds: 4 },
		{ id: 'left', isVisible: true, visibleStartSeconds: 0, visibleEndSeconds: 0.5 },
		{ id: 'right', isVisible: true, visibleStartSeconds: 0.5, visibleEndSeconds: 1 },
		{ id: 'later-tie', isVisible: true, visibleStartSeconds: 0.75, visibleEndSeconds: 1 },
	];

	assert.equal(rightmostVisibleClip(clips).id, 'later-tie');
	assert.equal(rightmostVisibleClip([{ id: 'hidden', isVisible: false }]), null);
	assert.throws(() => rightmostVisibleClip(null), /clips must be an array/);
});

test('bounded canvas dimensions preserve normal high-DPI output and cap each allocation limit', () => {
	assert.deepEqual(boundedCanvasDimensions(320, 120, { devicePixelRatio: 2 }), {
		cssWidth: 320,
		cssHeight: 120,
		backingWidth: 640,
		backingHeight: 240,
		requestedPixelRatio: 2,
		pixelRatioX: 2,
		pixelRatioY: 2,
	});
	const ratioCapped = boundedCanvasDimensions(100, 50, {
		devicePixelRatio: 4,
		maximumPixelRatio: 1.5,
	});
	assert.equal(ratioCapped.requestedPixelRatio, 1.5);
	assert.equal(ratioCapped.backingWidth, 150);
	assert.equal(ratioCapped.backingHeight, 75);

	const dimensionCapped = boundedCanvasDimensions(10_000, 1_000, {
		devicePixelRatio: 2,
		maximumBackingWidth: 1_000,
		maximumBackingHeight: 500,
		maximumBackingPixels: 500_000,
	});
	assert.equal(dimensionCapped.backingWidth, 1_000);
	assert.equal(dimensionCapped.backingHeight, 100);
	assert.ok(dimensionCapped.backingWidth * dimensionCapped.backingHeight <= 500_000);

	const pixelCapped = boundedCanvasDimensions(1_000, 1_000, {
		devicePixelRatio: 2,
		maximumBackingPixels: 250_000,
	});
	assert.equal(pixelCapped.backingWidth, 500);
	assert.equal(pixelCapped.backingHeight, 500);
	assert.throws(() => boundedCanvasDimensions(0, 10), /cssWidth/);
	assert.throws(() => boundedCanvasDimensions(10, 10, { devicePixelRatio: 0 }), /devicePixelRatio/);
});

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
