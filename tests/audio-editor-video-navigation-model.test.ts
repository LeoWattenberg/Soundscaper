/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	VIDEO_SHUTTLE_RATES,
	createVideoShuttleAnchor,
	resolveAdjacentVideoEditPoint,
	resolveVideoProgramGeometry,
	resolveVideoShuttlePosition,
	stepVideoShuttleRate,
	type VideoShuttleRate,
} from '../src/common/editor/video-navigation-model.ts';
import { sequenceFrameBoundarySample } from '../src/common/editor/sequence-frame-navigation.ts';
import type { VideoEditTargets } from '../src/common/editor/video-edit-targeting.ts';

const NTSC = Object.freeze({ num: 30_000, den: 1_001 });
const PAL = Object.freeze({ num: 25, den: 1 });

function project(rate: Readonly<{ num: number; den: number }> = PAL) {
	return {
		id: 'project-1',
		sampleRate: 48_000,
		primarySequenceId: 'main',
		sequences: [{
			id: 'main',
			rate,
			trackIds: ['video-a', 'audio-a', 'video-b', 'video-hidden'],
		}],
		tracks: [
			{ id: 'video-a', type: 'video', laneGroupId: 'lane-a', clipIds: ['a-1', 'a-2'] },
			{ id: 'audio-a', type: 'audio', laneGroupId: 'lane-a', clipIds: [] },
			{ id: 'video-b', type: 'video', laneGroupId: 'lane-b', clipIds: ['b-1'] },
			{ id: 'video-hidden', type: 'video', hidden: true, clipIds: ['hidden-1'] },
		],
		clips: [
			videoClip('a-1', 0, 10),
			videoClip('a-2', 10, 10),
			videoClip('b-1', 5, 10),
			videoClip('hidden-1', 3, 30),
		],
	};
}

function videoClip(id: string, sequenceStartFrame: number, sequenceFrameCount: number) {
	return {
		id,
		kind: 'video',
		sequenceId: 'main',
		sequenceStartFrame,
		sequenceFrameCount,
	};
}

function targets(
	videoTrackId: string | null,
	explicit: boolean,
): VideoEditTargets {
	return Object.freeze({
		sequenceId: 'main',
		videoTrackId,
		audioTrackId: null,
		explicit,
	});
}

test('J and L move one step through the complete shuttle-rate ladder', () => {
	assert.deepEqual(VIDEO_SHUTTLE_RATES, [-8, -4, -2, -1, 0, 1, 2, 4, 8]);
	let rate: VideoShuttleRate = 0;
	for (const expected of [-1, -2, -4, -8, -8] as const) {
		rate = stepVideoShuttleRate(rate, -1);
		assert.equal(rate, expected);
	}
	for (const expected of [-4, -2, -1, 0, 1, 2, 4, 8, 8] as const) {
		rate = stepVideoShuttleRate(rate, 1);
		assert.equal(rate, expected);
	}
	assert.throws(() => stepVideoShuttleRate(3 as 1, 1), /shuttle rate/u);
	assert.throws(() => stepVideoShuttleRate(0, 0 as 1), /direction/u);
});

test('a shuttle anchor aligns to the frame boundary in its travel direction', () => {
	const geometry = resolveVideoProgramGeometry(project());
	const offGrid = sequenceFrameBoundarySample(1, PAL, 48_000) + 100;
	const forward = createVideoShuttleAnchor(geometry, offGrid, 1, 50);
	const reverse = createVideoShuttleAnchor(geometry, offGrid, -1, 50);
	assert.equal(forward.anchorSequenceFrame, 2);
	assert.equal(forward.anchorSample, sequenceFrameBoundarySample(2, PAL, 48_000));
	assert.equal(reverse.anchorSequenceFrame, 1);
	assert.equal(reverse.anchorSample, sequenceFrameBoundarySample(1, PAL, 48_000));
});

test('fractional-rate shuttle positions always derive from the absolute anchor', () => {
	const geometry = resolveVideoProgramGeometry({
		...project(NTSC),
		clips: [videoClip('a-1', 0, 400_000)],
		tracks: [{ id: 'video-a', type: 'video', clipIds: ['a-1'] }],
		sequences: [{ id: 'main', rate: NTSC, trackIds: ['video-a'] }],
	});
	const anchor = createVideoShuttleAnchor(
		geometry,
		sequenceFrameBoundarySample(7, NTSC, 48_000),
		8,
		1_000,
	);
	for (const elapsed of [17, 51, 149, 10_010, 100_100]) {
		resolveVideoShuttlePosition(anchor, 1_000 + elapsed);
	}
	const final = resolveVideoShuttlePosition(anchor, 101_100);
	assert.equal(final.sequenceFrame, 24_007);
	assert.equal(final.sample, sequenceFrameBoundarySample(24_007, NTSC, 48_000));
	assert.equal(final.ended, false);
	// Resolving only the final instant gives the same answer; intermediate timer
	// cadence cannot accumulate rounding error.
	assert.deepEqual(resolveVideoShuttlePosition(anchor, 101_100), final);
});

test('shuttle positions clamp and report both program ends', () => {
	const geometry = resolveVideoProgramGeometry(project());
	assert.equal(geometry.programEndSequenceFrame, 20);
	assert.equal(geometry.programEndSample, sequenceFrameBoundarySample(20, PAL, 48_000));
	const reverse = createVideoShuttleAnchor(
		geometry,
		sequenceFrameBoundarySample(2, PAL, 48_000),
		-8,
		0,
	);
	assert.deepEqual(resolveVideoShuttlePosition(reverse, 1_000), {
		sequenceFrame: 0,
		sample: 0,
		ended: true,
	});
	const forward = createVideoShuttleAnchor(
		geometry,
		sequenceFrameBoundarySample(19, PAL, 48_000),
		4,
		0,
	);
	assert.deepEqual(resolveVideoShuttlePosition(forward, 1_000), {
		sequenceFrame: 20,
		sample: sequenceFrameBoundarySample(20, PAL, 48_000),
		ended: true,
	});
});

test('edit navigation follows explicit and inherited video lanes exactly', () => {
	const document = project();
	const atTen = sequenceFrameBoundarySample(10, PAL, 48_000);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets('video-a', true), 'previous'),
		sequenceFrameBoundarySample(0, PAL, 48_000),
	);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets('video-a', true), 'next'),
		sequenceFrameBoundarySample(20, PAL, 48_000),
	);
	// A video lane inherited from either a selected video track or its paired
	// audio lane is still one exact lane, not an invitation to scan all tracks.
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets('video-b', false), 'previous'),
		sequenceFrameBoundarySample(5, PAL, 48_000),
	);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets('video-b', false), 'next'),
		sequenceFrameBoundarySample(15, PAL, 48_000),
	);
});

test('untargeted navigation scans visible lanes, deduplicates ties, and stays strict', () => {
	const document = project();
	const atTen = sequenceFrameBoundarySample(10, PAL, 48_000);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets(null, false), 'previous'),
		sequenceFrameBoundarySample(5, PAL, 48_000),
	);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets(null, false), 'next'),
		sequenceFrameBoundarySample(15, PAL, 48_000),
	);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, sequenceFrameBoundarySample(4, PAL, 48_000), targets(null, false), 'previous'),
		sequenceFrameBoundarySample(0, PAL, 48_000),
	);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, sequenceFrameBoundarySample(20, PAL, 48_000), targets(null, false), 'next'),
		null,
	);
	// The hidden lane's frame-33 end never becomes the program extent or an edit point.
	assert.equal(resolveVideoProgramGeometry(document).programEndSequenceFrame, 20);
});

test('an explicit empty or hidden target yields no edit points', () => {
	const document = project();
	assert.equal(resolveAdjacentVideoEditPoint(document, 0, targets(null, true), 'next'), null);
	assert.equal(resolveAdjacentVideoEditPoint(document, 0, targets('video-hidden', true), 'next'), null);
	assert.equal(resolveAdjacentVideoEditPoint(document, 0, targets('missing', false), 'next'), null);
});

test('edit navigation skips locked lanes without removing them from program geometry', () => {
	const document = {
		...project(),
		tracks: project().tracks.map((track) => (
			track.id === 'video-a' ? { ...track, locked: true } : track
		)),
	};
	const atTen = sequenceFrameBoundarySample(10, PAL, 48_000);
	assert.equal(resolveVideoProgramGeometry(document).programEndSequenceFrame, 20);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets('video-a', true), 'next'),
		null,
	);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets('video-a', false), 'previous'),
		null,
	);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets(null, false), 'previous'),
		sequenceFrameBoundarySample(5, PAL, 48_000),
	);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, atTen, targets(null, false), 'next'),
		sequenceFrameBoundarySample(15, PAL, 48_000),
	);
});

test('edit points are converted once through the sequence rational rate', () => {
	const document = project(NTSC);
	assert.equal(
		resolveAdjacentVideoEditPoint(document, 1, targets('video-a', true), 'next'),
		sequenceFrameBoundarySample(10, NTSC, 48_000),
	);
});
