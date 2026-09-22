/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	automaticClipCrossfadeRanges,
	mergeFrameRanges,
} from '../src/common/editor/audio-clip-overlap.ts';
import {
	evaluateClipCrossfadeAt,
	evaluateClipEdgeGainAt,
	evaluateClipTransitionGainAt,
} from '../src/common/editor/audio-clip-transition-gain.ts';

interface TestClip {
	readonly id: string;
	readonly start: number;
	readonly duration: number;
}

const accessors = {
	id: (clip: TestClip) => clip.id,
	startFrame: (clip: TestClip) => clip.start,
	durationFrames: (clip: TestClip) => clip.duration,
};

test('automatic clip crossfades share one projection for chains while contained clips remain drop-ins', () => {
	const ranges = automaticClipCrossfadeRanges<TestClip>([
		{ id: 'outer', start: 0, duration: 10 },
		{ id: 'contained', start: 2, duration: 3 },
		{ id: 'middle', start: 5, duration: 7 },
		{ id: 'right', start: 7, duration: 8 },
		{ id: 'same-start', start: 0, duration: 20 },
	], accessors);

	assert.deepEqual(ranges.get('outer'), {
		crossfadeInRanges: [],
		crossfadeOutRanges: [[5, 10]],
	});
	assert.deepEqual(ranges.get('contained'), {
		crossfadeInRanges: [],
		crossfadeOutRanges: [],
	});
	assert.deepEqual(ranges.get('middle'), {
		crossfadeInRanges: [[0, 5]],
		crossfadeOutRanges: [[2, 7]],
	});
	assert.deepEqual(ranges.get('right'), {
		crossfadeInRanges: [[0, 5]],
		crossfadeOutRanges: [],
	});
	assert.deepEqual(ranges.get('same-start'), {
		crossfadeInRanges: [],
		crossfadeOutRanges: [],
	});
});

test('automatic clip crossfades delegate range normalization to the shared merger by default', () => {
	assert.deepEqual(
		mergeFrameRanges([[5, 9], [1, 3], [3, 6], [8, 8], [Number.NaN, 2]]),
		[[1, 9]],
	);
	const calls: (readonly (readonly [number, number])[])[] = [];
	automaticClipCrossfadeRanges<TestClip>([
		{ id: 'left', start: 0, duration: 10 },
		{ id: 'right', start: 5, duration: 10 },
	], accessors, (ranges) => {
		calls.push(ranges);
		return mergeFrameRanges(ranges);
	});
	assert.equal(calls.length, 4, 'both range directions for both clips use the supplied normalizer');
});

test('clip transition gain owns explicit fades and overlapping automatic crossfades', () => {
	const crossfadeRanges = [[5, 15], [10, 20]] as const;
	const expectedCrossfadeOut = new Map([
		[4, 1], [5, 1], [10, 0.5], [15, 0], [16, 0.4], [20, 0], [21, 1],
	]);
	for (const [frame, expected] of expectedCrossfadeOut) {
		assert.equal(evaluateClipCrossfadeAt(frame, crossfadeRanges, 'out'), expected, `frame ${frame}`);
	}

	assert.equal(evaluateClipEdgeGainAt(5, 30, 10, [], 'in'), 0.5);
	assert.equal(evaluateClipEdgeGainAt(25, 30, 10, [], 'out'), 0.5);
	assert.equal(evaluateClipEdgeGainAt(15, 30, 0, [[5, 15]], 'out'), 0);
	assert.equal(evaluateClipEdgeGainAt(16, 30, 0, [[5, 15]], 'out'), 1);
	assert.equal(evaluateClipEdgeGainAt(95, 100, 10, [[90, 100]], 'out'), 0.5);
	assert.equal(evaluateClipEdgeGainAt(5, 100, 10, [[0, 10]], 'in'), 0.5);
	assert.equal(evaluateClipTransitionGainAt(15, 30, {
		fadeInFrames: 20,
		fadeOutFrames: 20,
		crossfadeInRanges: [],
		crossfadeOutRanges: [],
	}), 0.75 * 0.75);
});
