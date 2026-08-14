/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_SHOT_INDEX_SCHEMA_VERSION,
	buildShotIndex,
	keyframeFramesForShot,
	shotAt,
	shotsFromBoundaries,
	snapFrameToShotBoundary,
} from '../src/common/editor/assistance/shots.ts';

const RATE = 48_000;

function index(shots: readonly { startFrame: number; endFrame: number; score?: number }[]) {
	return buildShotIndex({
		sourceId: 'source-1',
		sampleRate: RATE,
		detector: 'ffmpeg-scene-score',
		shots: shots.map((shot) => ({ score: 0.5, ...shot })),
	});
}

test('a source with no detected boundary is one shot spanning all of it', () => {
	const shots = shotsFromBoundaries([], { durationFrames: 10 * RATE });

	assert.deepEqual(shots.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [[0, 10 * RATE]]);
});

test('boundaries become contiguous shots that cover the source exactly', () => {
	const shots = shotsFromBoundaries(
		[{ frame: 2 * RATE, score: 0.8 }, { frame: 5 * RATE, score: 0.6 }],
		{ durationFrames: 9 * RATE },
	);

	assert.deepEqual(shots.map(({ startFrame, endFrame }) => [startFrame, endFrame]), [
		[0, 2 * RATE], [2 * RATE, 5 * RATE], [5 * RATE, 9 * RATE],
	]);
	// The score that opened a shot travels with it, so a review list can show
	// how confident the detector was about that cut.
	assert.deepEqual(shots.map(({ score }) => score), [1, 0.8, 0.6]);
});

test('a dissolve fires the detector repeatedly and collapses to its strongest frame', () => {
	// The fast mode scores frame differences, so a gradual transition trips the
	// threshold several times running. Left alone that reads as a burst of
	// one-frame shots; this is the documented miss class of the fast detector.
	const burst = [
		{ frame: 4 * RATE, score: 0.42 },
		{ frame: 4 * RATE + 2000, score: 0.71 },
		{ frame: 4 * RATE + 4000, score: 0.55 },
	];
	const shots = shotsFromBoundaries(burst, { durationFrames: 9 * RATE, minimumShotFrames: RATE });

	assert.equal(shots.length, 2, 'the burst is one transition, not three');
	assert.equal(shots[1]?.startFrame, 4 * RATE + 2000, 'the strongest frame in the burst wins');
	assert.equal(shots[1]?.score, 0.71);
});

test('a boundary shorter than the minimum never creates a shot of its own', () => {
	const shots = shotsFromBoundaries(
		[{ frame: 100, score: 0.9 }, { frame: 5 * RATE, score: 0.9 }],
		{ durationFrames: 9 * RATE, minimumShotFrames: RATE },
	);

	assert.deepEqual(shots.map(({ startFrame }) => startFrame), [0, 5 * RATE]);
});

test('boundaries outside the source, or at its very start, are refused', () => {
	for (const frame of [-1, 0, 9 * RATE, 12 * RATE]) {
		assert.throws(
			() => shotsFromBoundaries([{ frame, score: 0.5 }], { durationFrames: 9 * RATE }),
			/boundary/iu,
			`frame ${frame}`,
		);
	}
});

test('a fractional frame is refused rather than rounded', () => {
	// Seconds are converted once at the adapter edge. A fraction reaching here
	// means a conversion was skipped, and rounding it would hide that.
	assert.throws(
		() => shotsFromBoundaries([{ frame: 1.5 * RATE + 0.5, score: 0.5 }], { durationFrames: 9 * RATE }),
		/integer/iu,
	);
	assert.throws(() => shotsFromBoundaries([], { durationFrames: 9.5 }), /integer/iu);
});

test('an unsorted detector result is sorted rather than trusted', () => {
	const shots = shotsFromBoundaries(
		[{ frame: 5 * RATE, score: 0.6 }, { frame: 2 * RATE, score: 0.8 }],
		{ durationFrames: 9 * RATE },
	);

	assert.deepEqual(shots.map(({ startFrame }) => startFrame), [0, 2 * RATE, 5 * RATE]);
});

test('an index refuses shots that gap, overlap, or leave the source uncovered', () => {
	assert.throws(() => index([{ startFrame: 0, endFrame: RATE }, { startFrame: 2 * RATE, endFrame: 3 * RATE }]), /contiguous/iu);
	assert.throws(() => index([{ startFrame: 0, endFrame: 2 * RATE }, { startFrame: RATE, endFrame: 3 * RATE }]), /contiguous/iu);
	assert.throws(() => index([{ startFrame: RATE, endFrame: 2 * RATE }]), /start at zero/iu);
	assert.throws(() => index([{ startFrame: 0, endFrame: 0 }]), /empty/iu);
	assert.throws(() => index([]), /at least one shot/iu);
});

test('an index carries its schema version and reports the shot at a frame', () => {
	const built = index([
		{ startFrame: 0, endFrame: 2 * RATE },
		{ startFrame: 2 * RATE, endFrame: 5 * RATE },
	]);

	assert.equal(built.schemaVersion, ASSISTANCE_SHOT_INDEX_SCHEMA_VERSION);
	assert.equal(shotAt(built, 0)?.endFrame, 2 * RATE);
	assert.equal(shotAt(built, 2 * RATE)?.endFrame, 5 * RATE, 'a boundary frame belongs to the shot it opens');
	assert.equal(shotAt(built, 5 * RATE - 1)?.startFrame, 2 * RATE);
	assert.equal(shotAt(built, 5 * RATE), null, 'past the end there is no shot');
	assert.equal(shotAt(built, -1), null);
});

test('snapping moves a frame onto a nearby cut and leaves a distant one alone', () => {
	// 7B-4 snaps clip edges so no clip starts mid-cut. Snapping must be
	// bounded: a frame far from any cut is a deliberate position.
	const built = index([
		{ startFrame: 0, endFrame: 2 * RATE },
		{ startFrame: 2 * RATE, endFrame: 5 * RATE },
		{ startFrame: 5 * RATE, endFrame: 9 * RATE },
	]);

	assert.equal(snapFrameToShotBoundary(built, 2 * RATE + 500, RATE), 2 * RATE);
	assert.equal(snapFrameToShotBoundary(built, 2 * RATE - 500, RATE), 2 * RATE);
	// Midway between the cuts at 2s and 5s, so 1.5s from either: beyond a
	// one-second tolerance in both directions.
	assert.equal(snapFrameToShotBoundary(built, 3.5 * RATE, RATE), 3.5 * RATE, 'too far to snap');
	// Exactly at the tolerance still snaps; the bound is inclusive.
	assert.equal(snapFrameToShotBoundary(built, 3 * RATE, RATE), 2 * RATE);
	assert.equal(snapFrameToShotBoundary(built, 100, RATE), 0, 'the source start is a boundary');
	assert.equal(snapFrameToShotBoundary(built, 9 * RATE - 100, RATE), 9 * RATE, 'so is the source end');
	assert.equal(snapFrameToShotBoundary(built, 3 * RATE, 0), 3 * RATE, 'zero tolerance never snaps');
});

test('keyframe sampling stays shot-aware and never goes dense', () => {
	const shot = { startFrame: 0, endFrame: 10 * RATE, score: 1 };

	assert.deepEqual(keyframeFramesForShot(shot, 1), [5 * RATE]);
	assert.equal(keyframeFramesForShot(shot, 3).length, 3);
	// Samples sit strictly inside the shot so a frame is never taken on the cut
	// itself, where a dissolve would blend two shots into one unusable frame.
	for (const frame of keyframeFramesForShot(shot, 3)) {
		assert.ok(frame > shot.startFrame && frame < shot.endFrame, `${frame} is inside the shot`);
	}
	assert.deepEqual(keyframeFramesForShot(shot, 0), []);

	// A shot shorter than the requested sample count yields fewer, distinct
	// frames rather than the same frame repeatedly.
	const brief = { startFrame: 0, endFrame: 2, score: 1 };
	const sampled = keyframeFramesForShot(brief, 3);
	assert.equal(new Set(sampled).size, sampled.length, 'sampled frames are distinct');
	assert.ok(sampled.length <= 3);
});

test('shots built from boundaries validate as an index', () => {
	const shots = shotsFromBoundaries(
		[{ frame: 2 * RATE, score: 0.8 }],
		{ durationFrames: 9 * RATE },
	);
	const built = buildShotIndex({
		sourceId: 'source-1', sampleRate: RATE, detector: 'ffmpeg-scene-score', shots,
	});

	assert.equal(built.shots.length, 2);
	assert.equal(built.detector, 'ffmpeg-scene-score');
});
