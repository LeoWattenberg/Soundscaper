/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Property coverage for merging an editing selection into normalised ranges.
 *
 * Every range command starts by folding whatever the selection happens to hold
 * into disjoint, ordered spans, so an overlap the merge missed would be an edit
 * applied twice to the same frames. The merge claims to be independent of the
 * order the ranges arrive in; that is checked here against a frame-by-frame
 * union rather than assumed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import { mergeEditingRanges } from '../src/common/editor/commands/clip-basic-runtime.js';

const SEED = 20_260_906;
const RUNS = 200;

interface EditingRange {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly durationFrames?: number;
}

const rangeArbitrary: fc.Arbitrary<EditingRange> = fc
	.tuple(fc.integer({ min: 0, max: 240 }), fc.integer({ min: 1, max: 60 }))
	.map(([startFrame, length]) => ({ startFrame, endFrame: startFrame + length }));
const rangesArbitrary = fc.array(rangeArbitrary, { minLength: 1, maxLength: 10, size: 'max' });

function merge(ranges: readonly EditingRange[]): EditingRange[] {
	return mergeEditingRanges(ranges) as EditingRange[];
}

/** The same union, worked out one frame at a time. */
function modelMerge(ranges: readonly EditingRange[]): EditingRange[] {
	const end = ranges.reduce((maximum, range) => Math.max(maximum, range.endFrame), 0);
	const merged: EditingRange[] = [];
	let openedAt: number | null = null;
	for (let frame = 0; frame <= end; frame += 1) {
		const inside = frame < end
			&& ranges.some((range) => frame >= range.startFrame && frame < range.endFrame);
		if (inside && openedAt === null) openedAt = frame;
		if (!inside && openedAt !== null) {
			merged.push({ startFrame: openedAt, endFrame: frame, durationFrames: frame - openedAt });
			openedAt = null;
		}
	}
	return merged;
}

test('merging yields the union of the selection as ordered, disjoint ranges', () => {
	fc.assert(
		fc.property(rangesArbitrary, (ranges) => {
			const before = JSON.stringify(ranges);
			const merged = merge(ranges);
			assert.equal(JSON.stringify(ranges), before, 'the selection handed in is not mutated');
			assert.deepEqual(merged, modelMerge(ranges));
			let previousEnd = Number.NEGATIVE_INFINITY;
			for (const range of merged) {
				assert.ok(range.startFrame < range.endFrame, 'every merged range has a positive duration');
				assert.equal(range.durationFrames, range.endFrame - range.startFrame);
				assert.ok(
					range.startFrame > previousEnd,
					'merged ranges are ordered and never touch, or the union would still be splittable',
				);
				previousEnd = range.endFrame;
			}
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('merging is independent of order and settles after one pass', () => {
	fc.assert(
		fc.property(rangesArbitrary, fc.integer({ min: 0, max: 512 }), (ranges, rotation) => {
			const merged = merge(ranges);
			const rotated = ranges.map((_, index) => ranges[(index + rotation) % ranges.length]);
			assert.deepEqual(merge(rotated), merged, 'rotating the selection changes nothing');
			assert.deepEqual(merge([...ranges].reverse()), merged, 'nor does reversing it');
			assert.deepEqual(merge(merged), merged, 'merging an already-merged selection is a no-op');
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a range the frame domain cannot hold is refused rather than repaired', () => {
	fc.assert(
		fc.property(
			fc.oneof(
				fc.tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: -100, max: 0 }))
					.map(([startFrame, offset]) => ({ startFrame, endFrame: startFrame + offset })),
				fc.tuple(fc.integer({ min: -100, max: -1 }), fc.integer({ min: 1, max: 100 }))
					.map(([startFrame, length]) => ({ startFrame, endFrame: startFrame + length })),
				fc.constantFrom<EditingRange>(
					{ startFrame: 0.5, endFrame: 10 },
					{ startFrame: 0, endFrame: 10.5 },
					{ startFrame: Number.NaN, endFrame: 10 },
					{ startFrame: 0, endFrame: Number.POSITIVE_INFINITY },
					{ startFrame: 0, endFrame: Number.MAX_SAFE_INTEGER + 2 },
				),
			),
			rangesArbitrary,
			(invalid, valid) => {
				assert.throws(() => merge([...valid, invalid]), RangeError);
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});
