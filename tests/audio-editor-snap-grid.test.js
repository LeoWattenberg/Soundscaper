import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDIO_EDITOR_SNAP_GRIDS,
	AUDIO_EDITOR_SNAP_GRID_IDS,
	AUDIO_EDITOR_SNAP_UPSTREAM_MAX,
	AUDIO_EDITOR_SNAP_UPSTREAM_MIN,
	audioEditorSnapGrid,
	audioEditorSnapStepFrames,
	normalizeAudioEditorSnapSettings,
	snapAudioEditorFrameWithProject,
	snapAudioEditorProjectFrame,
	stepAudioEditorSnappedFrame,
} from '../src/lib/tools/audio-editor/snap-grid.js';

test('snap grid inventory matches all pinned Audacity 4 types in numeric order', () => {
	assert.equal(AUDIO_EDITOR_SNAP_UPSTREAM_MIN, 0);
	assert.equal(AUDIO_EDITOR_SNAP_UPSTREAM_MAX, 17);
	assert.equal(AUDIO_EDITOR_SNAP_GRIDS.length, 18);
	assert.deepEqual(AUDIO_EDITOR_SNAP_GRIDS.map((grid) => grid.upstreamType), [...Array(18).keys()]);
	assert.deepEqual(AUDIO_EDITOR_SNAP_GRID_IDS, [
		'bar', '1/2', '1/4', '1/8', '1/16', '1/32', '1/64', '1/128',
		'seconds', 'deciseconds', 'centiseconds', 'milliseconds', 'samples',
		'video-24', 'video-ntsc', 'video-ntsc-drop', 'video-pal', 'cdda',
	]);
	assert.ok(AUDIO_EDITOR_SNAP_GRIDS.every(Object.isFrozen));
});

test('snap grids resolve numeric profiles, aliases, and legacy V2 unit spellings', () => {
	assert.equal(audioEditorSnapGrid(0).id, 'bar');
	assert.equal(audioEditorSnapGrid('17').id, 'cdda');
	assert.equal(audioEditorSnapGrid('beats').id, '1/4');
	assert.equal(audioEditorSnapGrid('frames').id, 'video-24');
	assert.equal(audioEditorSnapGrid('ntsc-29.97').id, 'video-ntsc');
	assert.equal(audioEditorSnapGrid({ opaqueType: 16 }).id, 'video-pal');
	assert.equal(audioEditorSnapGrid({ unit: '1/16-triplet', opaqueType: 0 }).id, '1/16');
	assert.equal(audioEditorSnapGrid('1/16-triplet').impliedTriplets, true);
	assert.throws(() => audioEditorSnapGrid('1/256'), /Unsupported snap grid/);
	assert.throws(() => audioEditorSnapGrid(18), /Unsupported Audacity snap type/);
});

test('snap settings normalize modes, triplets, aliases, and pinned numeric type', () => {
	assert.deepEqual(normalizeAudioEditorSnapSettings({
		enabled: true, unit: '1/32-triplet', mode: 'floor', triplets: false,
	}), {
		enabled: true,
		unit: '1/32',
		division: '1/32',
		mode: 'previous',
		triplets: true,
		opaqueType: 5,
	});
	assert.deepEqual(normalizeAudioEditorSnapSettings({ enabled: true, opaqueType: 10, isSnapTriplets: true }), {
		enabled: true,
		unit: 'centiseconds',
		division: 'centiseconds',
		mode: 'nearest',
		triplets: false,
		opaqueType: 10,
	});
	assert.throws(() => normalizeAudioEditorSnapSettings({ mode: 'sideways' }), /Unsupported snap mode/);
});

test('seconds through samples snap frame-accurately using nearest, previous, and next modes', () => {
	const context = { sampleRate: 48_000 };
	assert.equal(audioEditorSnapStepFrames('seconds', context), 48_000);
	assert.equal(audioEditorSnapStepFrames('deciseconds', context), 4_800);
	assert.equal(audioEditorSnapStepFrames('centiseconds', context), 480);
	assert.equal(audioEditorSnapStepFrames('milliseconds', context), 48);
	assert.equal(audioEditorSnapStepFrames('samples', context), 1);
	assert.equal(snapAudioEditorProjectFrame(23_999, 'seconds', context), 0);
	assert.equal(snapAudioEditorProjectFrame(24_000, 'seconds', context), 48_000);
	assert.equal(snapAudioEditorProjectFrame(4_801, 'deciseconds', context), 4_800);
	assert.equal(snapAudioEditorProjectFrame(4_801, 'deciseconds', { ...context, mode: 'previous' }), 4_800);
	assert.equal(snapAudioEditorProjectFrame(4_801, 'deciseconds', { ...context, mode: 'next' }), 9_600);
	assert.equal(snapAudioEditorProjectFrame(12_345, 'samples', context), 12_345);
});

test('musical divisions through 1/128 and triplets use project tempo and signature', () => {
	const context = {
		sampleRate: 48_000,
		tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 } },
	};
	assert.equal(audioEditorSnapStepFrames('bar', context), 96_000);
	assert.equal(audioEditorSnapStepFrames('1/2', context), 48_000);
	assert.equal(audioEditorSnapStepFrames('1/4', context), 24_000);
	assert.equal(audioEditorSnapStepFrames('1/8', context), 12_000);
	assert.equal(audioEditorSnapStepFrames('1/16', context), 6_000);
	assert.equal(audioEditorSnapStepFrames('1/32', context), 3_000);
	assert.equal(audioEditorSnapStepFrames('1/64', context), 1_500);
	assert.equal(audioEditorSnapStepFrames('1/128', context), 750);
	assert.equal(audioEditorSnapStepFrames('1/4-triplet', context), 16_000);
	assert.equal(audioEditorSnapStepFrames({ unit: '1/128', triplets: true }, context), 500);
	assert.equal(snapAudioEditorProjectFrame(60_500, '1/128', context), 60_750);

	const sevenEight = { sampleRate: 48_000, bpm: 120, timeSignature: { numerator: 7, denominator: 8 } };
	assert.equal(audioEditorSnapStepFrames('bar', sevenEight), 84_000);
	assert.equal(audioEditorSnapStepFrames('1/8', sevenEight), 12_000);
	assert.equal(audioEditorSnapStepFrames({ unit: 'bar', triplets: true }, sevenEight), 84_000);
});

test('video and CDDA grids use rational rates without incremental drift', () => {
	const context = { sampleRate: 44_100 };
	assert.equal(audioEditorSnapStepFrames('video-24', context), 1_837.5);
	assert.equal(snapAudioEditorProjectFrame(1_830, 'video-24', context), 1_838);
	assert.equal(snapAudioEditorProjectFrame(3_670, 'video-24', context), 3_675);
	assert.equal(snapAudioEditorProjectFrame(18_370, 'video-24', context), 18_375);
	assert.equal(audioEditorSnapStepFrames('cdda', context), 588);
	assert.equal(snapAudioEditorProjectFrame(590, 'cdda', context), 588);
	assert.equal(audioEditorSnapStepFrames('video-pal', context), 1_764);
	assert.equal(audioEditorSnapStepFrames('video-ntsc', context), 1_471.47);
	assert.equal(audioEditorSnapStepFrames('video-ntsc-drop', context), 1_471.47);
	assert.equal(snapAudioEditorProjectFrame(14_710, 'video-ntsc', context), 14_715);
});

test('project snapping observes enable state, project rate, tempo, modes, and explicit bounds', () => {
	const project = {
		sampleRate: 96_000,
		tempo: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 } },
		snap: { enabled: false, unit: '1/4', mode: 'nearest', triplets: false },
	};
	assert.equal(snapAudioEditorFrameWithProject(30_000, project), 30_000);
	assert.equal(snapAudioEditorFrameWithProject(30_000, project, { force: true }), 48_000);
	assert.equal(snapAudioEditorFrameWithProject(30_000, {
		...project,
		snap: { ...project.snap, enabled: true, mode: 'previous' },
	}), 0);
	assert.equal(snapAudioEditorProjectFrame(-10, 'samples', { minimumFrame: 0 }), 0);
	assert.equal(snapAudioEditorProjectFrame(10_000, 'seconds', { sampleRate: 1_000, maximumFrame: 5_000 }), 5_000);
	assert.equal(snapAudioEditorProjectFrame(-1_500, 'seconds', { sampleRate: 1_000, minimumFrame: null }), -2_000);
});

test('single-step snapping moves to the adjacent absolute grid point without drift', () => {
	const context = { sampleRate: 44_100 };
	assert.equal(stepAudioEditorSnappedFrame(1_830, 'right', 'video-24', context), 3_675);
	assert.equal(stepAudioEditorSnappedFrame(3_670, 'left', 'video-24', context), 1_838);
	assert.equal(stepAudioEditorSnappedFrame(0, 'left', 'seconds', { sampleRate: 48_000 }), 0);
	assert.equal(stepAudioEditorSnappedFrame(0, 'left', 'seconds', { sampleRate: 48_000, minimumFrame: null }), -48_000);
	assert.throws(() => stepAudioEditorSnappedFrame(0, 'up', 'seconds'), /Unsupported snap direction/);
});

test('snap helpers reject invalid rates, tempo, signatures, modes, frames, and bounds', () => {
	assert.throws(() => audioEditorSnapStepFrames('seconds', { sampleRate: 0 }), /sampleRate/);
	assert.throws(() => audioEditorSnapStepFrames('1/4', { bpm: Number.NaN }), /tempo.bpm/);
	assert.throws(
		() => audioEditorSnapStepFrames('bar', { timeSignature: { numerator: 4, denominator: 3 } }),
		/power of two/,
	);
	assert.throws(() => snapAudioEditorProjectFrame(0.5, 'samples'), /safe integer/);
	assert.throws(() => snapAudioEditorProjectFrame(0, 'samples', { mode: 'sideways' }), /Unsupported snap mode/);
	assert.throws(
		() => snapAudioEditorProjectFrame(0, 'samples', { minimumFrame: 10, maximumFrame: 9 }),
		/maximumFrame cannot precede/,
	);
});
