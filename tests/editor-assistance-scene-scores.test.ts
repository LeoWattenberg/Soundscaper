/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SCENE_SCORE_ABSOLUTE_FLOOR,
	sceneScoresToBoundaries,
} from '../src/common/editor/assistance/scene-scores.ts';

/** A run of frames at one score, as a steady shot produces. */
function steady(fromFrame: number, count: number, score: number, step = 1000) {
	return Array.from({ length: count }, (_unused, offset) => ({
		frame: fromFrame + offset * step,
		score,
	}));
}

test('no scores and flat scores both yield no boundary', () => {
	assert.deepEqual(sceneScoresToBoundaries([]), []);
	assert.deepEqual(sceneScoresToBoundaries(steady(0, 40, 0.02)), []);
	// A perfectly static source scores zero throughout and must not read as one
	// enormous cut at the first frame that differs by a rounding error.
	assert.deepEqual(sceneScoresToBoundaries(steady(0, 40, 0)), []);
});

test('a spike above a quiet baseline is a cut', () => {
	const scores = [...steady(0, 20, 0.02), { frame: 20_000, score: 0.85 }, ...steady(21_000, 20, 0.02)];

	const boundaries = sceneScoresToBoundaries(scores);

	assert.deepEqual(boundaries.map(({ frame }) => frame), [20_000]);
	assert.equal(boundaries[0]?.score, 0.85);
});

test('high-motion content does not turn every frame into a cut', () => {
	// A handheld or gameplay source scores high everywhere. A fixed threshold
	// floods it with false cuts; the detector compares against local variation
	// so only a genuine discontinuity stands out.
	const busy = steady(0, 60, 0.45);

	assert.deepEqual(sceneScoresToBoundaries(busy), []);

	// The cut must still be findable at that baseline. Scores are bounded at
	// one, so a rule asking for a multiple of the local score would demand
	// 1.125 here and could never be satisfied by any frame at all.
	const withCut = [...steady(0, 30, 0.45), { frame: 30_000, score: 0.97 }, ...steady(31_000, 30, 0.45)];
	assert.deepEqual(sceneScoresToBoundaries(withCut).map(({ frame }) => frame), [30_000]);
});

test('a flicker in a static shot stays below the absolute floor', () => {
	// Against a zero baseline any nonzero score is unusual, so relative
	// comparison alone would call a compression flicker a cut.
	const flicker = [...steady(0, 20, 0), { frame: 20_000, score: SCENE_SCORE_ABSOLUTE_FLOOR / 2 }, ...steady(21_000, 20, 0)];

	assert.deepEqual(sceneScoresToBoundaries(flicker), []);
});

test('a dissolve reports every frame it trips, leaving the collapse to the index', () => {
	// Detection stays honest about what it saw; deciding that a run of trips is
	// one transition belongs to shot construction, which knows the minimum
	// shot length.
	const scores = [
		...steady(0, 20, 0.02),
		{ frame: 20_000, score: 0.55 },
		{ frame: 21_000, score: 0.62 },
		{ frame: 22_000, score: 0.58 },
		...steady(23_000, 20, 0.02),
	];

	assert.deepEqual(sceneScoresToBoundaries(scores).map(({ frame }) => frame), [20_000, 21_000, 22_000]);
});

test('a cut at the very start or end of the source is still reported', () => {
	const atStart = [{ frame: 0, score: 0.9 }, ...steady(1000, 30, 0.02)];
	const atEnd = [...steady(0, 30, 0.02), { frame: 30_000, score: 0.9 }];

	assert.deepEqual(sceneScoresToBoundaries(atStart).map(({ frame }) => frame), [0]);
	assert.deepEqual(sceneScoresToBoundaries(atEnd).map(({ frame }) => frame), [30_000]);
});

test('the sensitivity is tunable and its bounds are enforced', () => {
	const scores = [...steady(0, 20, 0.05), { frame: 20_000, score: 0.3 }, ...steady(21_000, 20, 0.05)];

	assert.deepEqual(sceneScoresToBoundaries(scores, { absoluteFloor: 0.2 }).map(({ frame }) => frame), [20_000]);
	assert.deepEqual(sceneScoresToBoundaries(scores, { absoluteFloor: 0.5 }), []);

	for (const absoluteFloor of [-0.1, 1.5, Number.NaN]) {
		assert.throws(() => sceneScoresToBoundaries(scores, { absoluteFloor }), /unit interval/iu, String(absoluteFloor));
	}
	for (const localSeparation of [0, 1, -0.5, Number.NaN]) {
		assert.throws(
			() => sceneScoresToBoundaries(scores, { localSeparation }),
			/between zero and one/iu,
			String(localSeparation),
		);
	}
	assert.throws(() => sceneScoresToBoundaries(scores, { windowFrames: 0 }), /positive/iu);
});

test('malformed detector output is refused rather than interpreted', () => {
	assert.throws(() => sceneScoresToBoundaries([{ frame: 1.5, score: 0.9 }]), /integer/iu);
	assert.throws(() => sceneScoresToBoundaries([{ frame: -1, score: 0.9 }]), /negative/iu);
	assert.throws(() => sceneScoresToBoundaries([{ frame: 0, score: 1.4 }]), /unit interval/iu);
	assert.throws(() => sceneScoresToBoundaries([{ frame: 0, score: Number.NaN }]), /unit interval/iu);
	assert.throws(
		() => sceneScoresToBoundaries([{ frame: 10, score: 0.1 }, { frame: 5, score: 0.1 }]),
		/ascending/iu,
	);
	assert.throws(
		() => sceneScoresToBoundaries([{ frame: 10, score: 0.1 }, { frame: 10, score: 0.2 }]),
		/ascending/iu,
	);
});

test('a short source still detects, using whatever neighbourhood it has', () => {
	const brief = [{ frame: 0, score: 0.01 }, { frame: 1000, score: 0.9 }, { frame: 2000, score: 0.01 }];

	assert.deepEqual(sceneScoresToBoundaries(brief).map(({ frame }) => frame), [1000]);
});
