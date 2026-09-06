/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Property coverage for what an overwrite removes and what survives it.
 *
 * These three helpers decide, before a single clip is written, which spans of
 * existing material an edit keeps. Their whole value is that the answer does
 * not depend on the order the cuts arrive in, so they are exercised against a
 * frame-by-frame model over generated layouts rather than worked examples.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import fc from 'fast-check';

import {
	appendOverwriteCut,
	assertNonOverlappingClips,
	remainingClipRanges,
} from '../src/common/editor/commands/clip-overwrite-ranges.js';

const SEED = 20_260_906;
const RUNS = 200;

interface Span {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
}

type Range = readonly [number, number];

/**
 * Clip durations are positive everywhere in the project model — every reader
 * takes them through `positiveSafeInteger` — so that is the domain these
 * helpers are held to.
 */
const spanArbitrary: fc.Arbitrary<Span> = fc.record({
	timelineStartFrame: fc.integer({ min: 0, max: 240 }),
	durationFrames: fc.integer({ min: 1, max: 120 }),
});
const spansArbitrary = fc.array(spanArbitrary, { minLength: 0, maxLength: 8, size: 'max' });

function endFrameOf(span: Span): number {
	return span.timelineStartFrame + span.durationFrames;
}

/** The surviving spans, worked out one frame at a time. */
function modelRemainingRanges(clip: Span, cuts: readonly Span[]): Range[] {
	const start = clip.timelineStartFrame;
	const end = endFrameOf(clip);
	const ranges: Range[] = [];
	let openedAt: number | null = null;
	for (let frame = start; frame < end; frame += 1) {
		const covered = cuts.some((cut) => frame >= cut.timelineStartFrame && frame < endFrameOf(cut));
		if (!covered && openedAt === null) openedAt = frame;
		if (covered && openedAt !== null) {
			ranges.push([openedAt, frame]);
			openedAt = null;
		}
	}
	if (openedAt !== null) ranges.push([openedAt, end]);
	return ranges;
}

function overlaps(first: Span, second: Span): boolean {
	return first.timelineStartFrame < endFrameOf(second) && second.timelineStartFrame < endFrameOf(first);
}

test('the surviving ranges are exactly the frames no cut covers', () => {
	fc.assert(
		fc.property(spanArbitrary, spansArbitrary, (clip, cuts) => {
			const ranges = remainingClipRanges(clip, cuts) as unknown as Range[];
			assert.deepEqual(ranges, modelRemainingRanges(clip, cuts));
			let previousEnd = clip.timelineStartFrame;
			for (const [startFrame, endFrame] of ranges) {
				assert.ok(startFrame < endFrame, 'a surviving range has a positive duration');
				assert.ok(startFrame >= previousEnd, 'surviving ranges are ordered and disjoint');
				assert.ok(endFrame <= endFrameOf(clip), 'a surviving range never leaves the clip');
				previousEnd = endFrame;
			}
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('the surviving ranges do not depend on the order the cuts arrive in', () => {
	fc.assert(
		fc.property(spanArbitrary, spansArbitrary, fc.integer({ min: 0, max: 512 }), (clip, cuts, rotation) => {
			const rotated = cuts.map((_, index) => cuts[(index + rotation) % Math.max(1, cuts.length)]);
			assert.deepEqual(remainingClipRanges(clip, rotated), remainingClipRanges(clip, cuts));
			assert.deepEqual(remainingClipRanges(clip, [...cuts].reverse()), remainingClipRanges(clip, cuts));
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('cutting what already survived removes nothing further', () => {
	fc.assert(
		fc.property(spanArbitrary, spansArbitrary, (clip, cuts) => {
			for (const [startFrame, endFrame] of remainingClipRanges(clip, cuts) as unknown as Range[]) {
				const survivor: Span = { timelineStartFrame: startFrame, durationFrames: endFrame - startFrame };
				assert.deepEqual(
					remainingClipRanges(survivor, cuts),
					[[startFrame, endFrame]],
					'a range the cuts already spared cannot be cut again',
				);
			}
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a track collects each distinct cut once, in span order', () => {
	fc.assert(
		fc.property(
			fc.array(fc.tuple(fc.constantFrom('track-a', 'track-b'), spanArbitrary), {
				minLength: 1,
				maxLength: 16,
				size: 'max',
			}),
			(appends) => {
				const cutsByTrackId = new Map<string, Span[]>();
				const seen = new Map<string, Set<string>>();
				for (const [trackId, span] of appends) {
					const key = `${String(span.timelineStartFrame)}:${String(endFrameOf(span))}`;
					const known = seen.get(trackId) ?? new Set<string>();
					const before = JSON.stringify(cutsByTrackId.get(trackId) ?? []);
					const added = appendOverwriteCut(cutsByTrackId, trackId, span) as boolean;
					assert.equal(added, !known.has(key), `appending ${key} to ${trackId} reported the wrong novelty`);
					if (!added) {
						assert.equal(JSON.stringify(cutsByTrackId.get(trackId)), before, 'a duplicate changes nothing');
					}
					known.add(key);
					seen.set(trackId, known);
				}
				for (const [trackId, cuts] of cutsByTrackId) {
					const keys = cuts.map((cut) => `${String(cut.timelineStartFrame)}:${String(endFrameOf(cut))}`);
					assert.deepEqual(new Set(keys), seen.get(trackId), 'the track holds exactly the distinct cuts');
					assert.equal(keys.length, new Set(keys).size, 'and holds none of them twice');
					for (let index = 1; index < cuts.length; index += 1) {
						const previous = cuts[index - 1];
						const current = cuts[index];
						assert.ok(
							previous.timelineStartFrame < current.timelineStartFrame
								|| (previous.timelineStartFrame === current.timelineStartFrame
									&& endFrameOf(previous) <= endFrameOf(current)),
							'cuts stay ordered by start then end',
						);
					}
				}
			},
		),
		{ seed: SEED, numRuns: RUNS },
	);
});

test('a track is refused exactly when two of its clips overlap', () => {
	fc.assert(
		fc.property(spansArbitrary, fc.integer({ min: 0, max: 512 }), (spans, rotation) => {
			const clips = spans.map((span, index) => ({ ...span, id: `clip-${String(index)}` }));
			const expected = clips.some((left, index) => clips.slice(index + 1).some((right) => overlaps(left, right)));
			const check = (ordered: typeof clips): boolean => {
				try {
					assertNonOverlappingClips('track-a', ordered);
					return false;
				} catch (error) {
					assert.ok(error instanceof RangeError, String(error));
					assert.match((error as RangeError).message, /track-a/u);
					return true;
				}
			};
			assert.equal(check(clips), expected, 'the refusal matches whether any pair actually overlaps');
			const rotated = clips.map((_, index) => clips[(index + rotation) % Math.max(1, clips.length)]);
			assert.equal(check(rotated), expected, 'and does not depend on the order the clips arrive in');
		}),
		{ seed: SEED, numRuns: RUNS },
	);
});
