/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	evaluateAudioWarpMap,
	evaluateAudioWarpMapAtSource,
	normalizeAudioWarpMap,
	quantizeAudioWarpTransients,
	trimAudioWarpMap,
	validateAudioWarpMap,
} from '../src/common/editor/audio-warp-domain.ts';
import { normalizeAudioGrooveTemplate } from '../src/common/editor/audio-groove-template.ts';

const IDENTITY_WARP = {
	feature: 'audio-warp',
	points: [
		{ outer: 0, source: 0, mode: 'forward' },
		{ outer: 10, source: 10, mode: 'forward' },
	],
} as const;

test('normalizes, freezes, and evaluates the existing audio warp breakpoint wire', () => {
	const map = normalizeAudioWarpMap({
		feature: 'audio-warp',
		points: [
			{ outer: 0, source: 100, mode: 'forward' },
			{ outer: 2, source: 120, mode: 'forward' },
			{ outer: 5, source: 180, mode: 'forward' },
		],
	});
	assert.deepEqual(map.points[0], {
		outer: { num: 0, den: 1 }, source: { num: 100, den: 1 }, mode: 'forward',
	});
	assert.ok(Object.isFrozen(map));
	assert.ok(Object.isFrozen(map.points));
	assert.ok(map.points.every((point) => Object.isFrozen(point) && Object.isFrozen(point.outer) && Object.isFrozen(point.source)));
	assert.equal(validateAudioWarpMap(map), true);
	assert.deepEqual(evaluateAudioWarpMap(map, 3), { num: 140, den: 1 });
	assert.deepEqual(evaluateAudioWarpMapAtSource(map, 140), { num: 3, den: 1 });
	assert.deepEqual(evaluateAudioWarpMap(map, -1), { num: 100, den: 1 });
	assert.deepEqual(evaluateAudioWarpMapAtSource(map, 999), { num: 5, den: 1 });
});

test('strict normalization rejects wrong features, open records, invalid modes, and inversions', () => {
	assert.throws(() => normalizeAudioWarpMap({ ...IDENTITY_WARP, feature: 'video-retime' }), /audio-warp/iu);
	assert.throws(() => normalizeAudioWarpMap({ ...IDENTITY_WARP, extra: true }), /unsupported field/iu);
	assert.throws(() => normalizeAudioWarpMap({
		feature: 'audio-warp',
		points: Array.from({ length: 4_097 }, (_, index) => ({ outer: index, source: index, mode: 'forward' })),
	}), /2 through 4096/iu);
	assert.throws(() => normalizeAudioWarpMap({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 1, source: 1, mode: 'freeze' },
		],
	}), /forward/iu);
	assert.throws(() => normalizeAudioWarpMap({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 0, source: 1, mode: 'forward' },
		],
	}), /outer.*strictly increasing/iu);
	assert.throws(() => normalizeAudioWarpMap({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 1, mode: 'forward' },
			{ outer: 1, source: 0, mode: 'forward' },
		],
	}), /source.*strictly increasing/iu);

	let getterRead = false;
	const accessor = Object.defineProperty({ feature: 'audio-warp' }, 'points', {
		enumerable: true,
		get() { getterRead = true; return IDENTITY_WARP.points; },
	});
	assert.throws(() => normalizeAudioWarpMap(accessor), /data property/iu);
	assert.equal(getterRead, false);
});

test('trim authoring inserts exact boundaries, rebases outer units, and preserves interior source anchors', () => {
	const original = normalizeAudioWarpMap({
		feature: 'audio-warp', points: [
			{ outer: 0, source: 100, mode: 'forward' },
			{ outer: 4, source: 140, mode: 'forward' },
			{ outer: 10, source: 200, mode: 'forward' },
		],
	});
	const trimmed = trimAudioWarpMap(original, { startOuter: 2, endOuter: 8 });
	assert.deepEqual(trimmed, {
		feature: 'audio-warp', points: [
			{ outer: { num: 0, den: 1 }, source: { num: 120, den: 1 }, mode: 'forward' },
			{ outer: { num: 2, den: 1 }, source: { num: 140, den: 1 }, mode: 'forward' },
			{ outer: { num: 6, den: 1 }, source: { num: 180, den: 1 }, mode: 'forward' },
		],
	});
	assert.deepEqual(original.points.map(({ outer, source }) => [outer, source]), [
		[{ num: 0, den: 1 }, { num: 100, den: 1 }],
		[{ num: 4, den: 1 }, { num: 140, den: 1 }],
		[{ num: 10, den: 1 }, { num: 200, den: 1 }],
	]);
	assert.throws(() => trimAudioWarpMap(original, { startOuter: 8, endOuter: 2 }), /positive/iu);
	assert.throws(() => trimAudioWarpMap(original, { startOuter: -1, endOuter: 2 }), /within.*map/iu);
	assert.throws(() => trimAudioWarpMap(original, { startOuter: 2, endOuter: 11 }), /within.*map/iu);
});

test('transient quantization has exact zero, one, and monotonic intermediate strength', () => {
	const zero = quantizeAudioWarpTransients(IDENTITY_WARP, [3], {
		grid: { origin: 0, interval: 2 }, strength: 0,
	});
	assert.deepEqual(zero, normalizeAudioWarpMap(IDENTITY_WARP));
	const quarter = quantizeAudioWarpTransients(IDENTITY_WARP, [3], {
		grid: { origin: 0, interval: 2 }, strength: { num: 1, den: 4 },
	});
	const half = quantizeAudioWarpTransients(IDENTITY_WARP, [3], {
		grid: { origin: 0, interval: 2 }, strength: { num: 1, den: 2 },
	});
	const full = quantizeAudioWarpTransients(IDENTITY_WARP, [3], {
		grid: { origin: 0, interval: 2 }, strength: 1,
	});
	assert.deepEqual(quarter.points[1], { outer: { num: 13, den: 4 }, source: { num: 3, den: 1 }, mode: 'forward' });
	assert.deepEqual(half.points[1], { outer: { num: 7, den: 2 }, source: { num: 3, den: 1 }, mode: 'forward' });
	assert.deepEqual(full.points[1], { outer: { num: 4, den: 1 }, source: { num: 3, den: 1 }, mode: 'forward' });
});

test('quantization preserves endpoints and unselected stable anchors', () => {
	const map = {
		feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 5, source: 50, mode: 'forward' },
			{ outer: 10, source: 100, mode: 'forward' },
		],
	} as const;
	const quantized = quantizeAudioWarpTransients(map, [30, 70], {
		grid: { origin: 0, interval: 2 }, strength: 1,
	});
	assert.deepEqual(quantized.points.map(({ outer, source }) => [outer, source]), [
		[{ num: 0, den: 1 }, { num: 0, den: 1 }],
		[{ num: 4, den: 1 }, { num: 30, den: 1 }],
		[{ num: 5, den: 1 }, { num: 50, den: 1 }],
		[{ num: 8, den: 1 }, { num: 70, den: 1 }],
		[{ num: 10, den: 1 }, { num: 100, den: 1 }],
	]);
});

test('quantization applies a reusable groove target with independently adjustable depth', () => {
	const groove = normalizeAudioGrooveTemplate({ offsets: [0, { num: 1, den: 3 }] });
	const straight = quantizeAudioWarpTransients(IDENTITY_WARP, [1], {
		grid: { origin: 0, interval: 1 }, strength: 1, groove, grooveStrength: 0,
	});
	const halfGroove = quantizeAudioWarpTransients(IDENTITY_WARP, [1], {
		grid: { origin: 0, interval: 1 }, strength: 1, groove, grooveStrength: { num: 1, den: 2 },
	});
	const fullGroove = quantizeAudioWarpTransients(IDENTITY_WARP, [1], {
		grid: { origin: 0, interval: 1 }, strength: 1, groove, grooveStrength: 1,
	});
	assert.deepEqual(straight.points[1].outer, { num: 1, den: 1 });
	assert.deepEqual(halfGroove.points[1].outer, { num: 7, den: 6 });
	assert.deepEqual(fullGroove.points[1].outer, { num: 4, den: 3 });
});

test('quantization keeps a transient whose move would collide instead of failing', () => {
	// Two onsets sharing a nearest grid line are ordinary material (eighth
	// notes on a quarter grid); the command stays total by leaving the
	// unquantizable transient where it is rather than refusing the action.
	const collided = quantizeAudioWarpTransients(IDENTITY_WARP, [4, { num: 41, den: 10 }], {
		grid: { origin: 0, interval: 2 }, strength: 1,
	});
	assert.deepEqual(collided.points.map(({ outer }) => outer), [
		{ num: 0, den: 1 }, { num: 4, den: 1 }, { num: 41, den: 10 }, { num: 10, den: 1 },
	]);

	// A lone colliding pair snaps the reachable transient onto the line.
	const paired = quantizeAudioWarpTransients(IDENTITY_WARP, [
		{ num: 39, den: 10 }, { num: 41, den: 10 },
	], { grid: { origin: 0, interval: 2 }, strength: 1 });
	assert.deepEqual(paired.points.map(({ outer }) => outer), [
		{ num: 0, den: 1 }, { num: 39, den: 10 }, { num: 4, den: 1 }, { num: 10, den: 1 },
	]);

	// A transient whose grid line is the end anchor cannot move onto it at
	// full strength, and cannot move past it at any strength.
	const anchored = quantizeAudioWarpTransients(IDENTITY_WARP, [9], {
		grid: { origin: 0, interval: 10 }, strength: 1,
	});
	assert.deepEqual(anchored.points.map(({ outer }) => outer), [
		{ num: 0, den: 1 }, { num: 9, den: 1 }, { num: 10, den: 1 },
	]);
	const partial = quantizeAudioWarpTransients(IDENTITY_WARP, [9], {
		grid: { origin: 0, interval: 10 }, strength: { num: 1, den: 2 },
	});
	assert.deepEqual(partial.points.map(({ outer }) => outer), [
		{ num: 0, den: 1 }, { num: 19, den: 2 }, { num: 10, den: 1 },
	]);
});

test('quantization rejects transient inversions, bounds, and invalid grids', () => {
	assert.throws(() => quantizeAudioWarpTransients(IDENTITY_WARP, [4, 3], {
		grid: { origin: 0, interval: 2 }, strength: 0,
	}), /transient.*strictly increasing/iu);
	assert.throws(() => quantizeAudioWarpTransients(IDENTITY_WARP, [-1], {
		grid: { origin: 0, interval: 2 }, strength: 1,
	}), /within.*source/iu);
	assert.throws(() => quantizeAudioWarpTransients(IDENTITY_WARP, [3], {
		grid: { origin: 0, interval: 0 }, strength: 1,
	}), /interval.*positive/iu);
	assert.throws(() => quantizeAudioWarpTransients(IDENTITY_WARP, [3], {
		grid: { origin: 0, interval: 2 }, strength: -0.1,
	}), /strength/iu);
});
