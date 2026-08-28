/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperImageBatchPlacementTimelineImage,
} from '../src/framescaper/editor-image-placement-timeline-image.ts';

type Data = Record<string, unknown>;

function project(overrides: Data = {}): Data {
	return {
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		primarySequenceId: 'seq-1',
		sequences: [{ id: 'seq-1', trackIds: ['track-1', 'track-2'] }],
		tracks: [
			{ id: 'track-1', type: 'video', clipIds: [] },
			{ id: 'track-2', type: 'video', clipIds: [] },
		],
		clips: [],
		selection: { trackIds: [] },
		...overrides,
	};
}

function request(overrides: Data = {}): Data {
	return {
		sequenceStartFrame: 10,
		sequenceFrameCounts: [5],
		createId: () => 'image-track-1',
		...overrides,
	};
}

function place(value: Data, requestValue: Data = request()): Data {
	return createFramescaperImageBatchPlacementTimelineImage(
		value,
		requestValue as never,
	) as unknown as Data;
}

test('an image batch is laid out consecutively from the requested start frame', () => {
	const placement = place(project(), request({ sequenceFrameCounts: [3, 4, 1] }));

	assert.equal(placement.sequenceId, 'seq-1');
	assert.deepEqual(placement.placements, [
		{ sequenceStartFrame: 10, sequenceFrameCount: 3 },
		{ sequenceStartFrame: 13, sequenceFrameCount: 4 },
		{ sequenceStartFrame: 17, sequenceFrameCount: 1 },
	]);
});

test('a clear video track already in the sequence is reused rather than duplicated', () => {
	const placement = place(project());

	assert.equal(placement.trackId, 'track-1');
	assert.equal(placement.trackCommand, null);
});

test('a clip ending exactly at the start frame leaves the range clear', () => {
	const placement = place(project({
		tracks: [
			{ id: 'track-1', type: 'video', clipIds: ['clip-1'] },
			{ id: 'track-2', type: 'video', clipIds: [] },
		],
		clips: [{ id: 'clip-1', sequenceId: 'seq-1', sequenceStartFrame: 5, sequenceFrameCount: 5 }],
	}));

	assert.equal(placement.trackId, 'track-1');
});

test('a clip overlapping the range by one frame moves the batch to the next track', () => {
	const placement = place(project({
		tracks: [
			{ id: 'track-1', type: 'video', clipIds: ['clip-1'] },
			{ id: 'track-2', type: 'video', clipIds: [] },
		],
		clips: [{ id: 'clip-1', sequenceId: 'seq-1', sequenceStartFrame: 5, sequenceFrameCount: 6 }],
	}));

	assert.equal(placement.trackId, 'track-2');
	assert.equal(placement.trackCommand, null);
});

test('a clip belonging to another sequence never occupies the range', () => {
	const placement = place(project({
		tracks: [
			{ id: 'track-1', type: 'video', clipIds: ['clip-1'] },
			{ id: 'track-2', type: 'video', clipIds: [] },
		],
		clips: [{ id: 'clip-1', sequenceId: 'seq-other', sequenceStartFrame: 0, sequenceFrameCount: 100 }],
	}));

	assert.equal(placement.trackId, 'track-1');
});

test('a locked track is not a placement candidate', () => {
	const placement = place(project({
		tracks: [
			{ id: 'track-1', type: 'video', locked: true, clipIds: [] },
			{ id: 'track-2', type: 'video', clipIds: [] },
		],
	}));

	assert.equal(placement.trackId, 'track-2');
});

test('a selected track is preferred over an earlier unselected one', () => {
	const placement = place(project({ selection: { trackIds: ['track-2'] } }));

	assert.equal(placement.trackId, 'track-2');
});

test('a track outside the primary sequence is not a placement candidate', () => {
	const placement = place(project({
		sequences: [{ id: 'seq-1', trackIds: ['track-1'] }],
		tracks: [
			{ id: 'track-1', type: 'video', clipIds: ['clip-1'] },
			{ id: 'track-2', type: 'video', clipIds: [] },
		],
		clips: [{ id: 'clip-1', sequenceId: 'seq-1', sequenceStartFrame: 0, sequenceFrameCount: 100 }],
	}));

	assert.equal(placement.trackId, 'image-track-1');
	assert.equal((placement.trackCommand as Data).index, 2);
});

test('a non-video track is not a placement candidate', () => {
	const placement = place(project({
		sequences: [{ id: 'seq-1', trackIds: ['track-1'] }],
		tracks: [{ id: 'track-1', type: 'audio', clipIds: [] }],
	}));

	assert.equal(placement.trackId, 'image-track-1');
	assert.equal((placement.trackCommand as Data).type, 'track/add');
});

test('an occupied sequence appends a new image track after the existing tracks', () => {
	const placement = place(project({
		tracks: [
			{ id: 'track-1', type: 'video', clipIds: ['clip-1'] },
			{ id: 'track-2', type: 'video', clipIds: ['clip-2'] },
		],
		clips: [
			{ id: 'clip-1', sequenceId: 'seq-1', sequenceStartFrame: 0, sequenceFrameCount: 100 },
			{ id: 'clip-2', sequenceId: 'seq-1', sequenceStartFrame: 0, sequenceFrameCount: 100 },
		],
	}));

	assert.equal(placement.trackId, 'image-track-1');
	assert.equal((placement.trackCommand as Data).index, 2);
});

test('a new image track identity that collides with an existing track is refused', () => {
	assert.throws(() => place(project({
		sequences: [{ id: 'seq-1', trackIds: ['track-1'] }],
		tracks: [{ id: 'track-1', type: 'video', clipIds: ['clip-1'] }],
		clips: [{ id: 'clip-1', sequenceId: 'seq-1', sequenceStartFrame: 0, sequenceFrameCount: 100 }],
	}), request({ createId: () => 'track-1' })), RangeError);
});

test('the batch size is bounded to 1 through 64 files', () => {
	assert.throws(() => place(project(), request({ sequenceFrameCounts: [] })), RangeError);
	assert.throws(
		() => place(project(), request({ sequenceFrameCounts: Array.from({ length: 65 }, () => 1) })),
		RangeError,
	);
	assert.equal(
		(place(project(), request({ sequenceFrameCounts: Array.from({ length: 64 }, () => 1) }))
			.placements as readonly unknown[]).length,
		64,
	);
});

test('a non-positive frame count and a negative start frame are refused', () => {
	assert.throws(() => place(project(), request({ sequenceFrameCounts: [0] })), RangeError);
	assert.throws(() => place(project(), request({ sequenceFrameCounts: [-1] })), RangeError);
	assert.throws(() => place(project(), request({ sequenceStartFrame: -1 })), RangeError);
});

test('a project outside the current Framescaper schema family cannot author a placement', () => {
	assert.throws(() => place(project({ schemaFamily: 'soundscaper' })), RangeError);
});

test('a missing primary sequence track order is refused', () => {
	assert.throws(() => place(project({ sequences: [] })), ReferenceError);
});
