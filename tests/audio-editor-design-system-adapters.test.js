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
	progressToDesignValue,
	projectClipsToViewport,
	rightmostVisibleClip,
	secondsToFrames,
} from '../src/common/editor/design-system-adapters.js';

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
	// The double 0.5 / 48_000 sits strictly below the exact half-frame
	// (no binary fraction lands on a 48 kHz tie), so exact point rounding
	// names frame 0; the former 1 was a floating-product artifact.
	assert.equal(secondsToFrames(0.5 / 48_000), 0);
	assert.equal(secondsToFrames(-100), 0);
	assert.equal(secondsToFrames(10, { minimumFrame: 100, maximumFrame: 200 }), 200);
	assert.equal(secondsToFrames(Number.MAX_VALUE), Number.MAX_SAFE_INTEGER);
	assert.equal(secondsToFrames(Number.MAX_SAFE_INTEGER / 48_000), Number.MAX_SAFE_INTEGER);
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
