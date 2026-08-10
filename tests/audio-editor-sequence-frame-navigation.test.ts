/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	sequenceFrameAtSample,
	sequenceFrameBoundarySample,
	snapSampleToSequenceFrame,
	stepSampleBySequenceFrames,
} from '../src/common/editor/sequence-frame-navigation.ts';
import {
	resolveSequenceTimingView,
	sampleAtSequenceTimecodeLabel,
	sequenceTimecodeLabelAtSample,
} from '../src/common/editor/sequence-timing-model.ts';

const NTSC = { num: 30_000, den: 1_001 };
const FILM = { num: 24, den: 1 };
const PAL = { num: 25, den: 1 };

function project(sequence: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{
			id: 'main-sequence',
			name: 'Main sequence',
			rate: { num: 30, den: 1 },
			dropFrame: false,
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
			trackIds: [],
			...sequence,
		}],
	};
}

test('a sample resolves to the frame whose resolved boundary contains it', () => {
	assert.equal(sequenceFrameBoundarySample(0, FILM, 44_100), 0);
	assert.equal(sequenceFrameBoundarySample(1, FILM, 44_100), 1_838);
	assert.equal(sequenceFrameBoundarySample(2, FILM, 44_100), 3_675);
	assert.equal(sequenceFrameAtSample(0, FILM, 44_100), 0);
	assert.equal(sequenceFrameAtSample(1_837, FILM, 44_100), 0);
	assert.equal(sequenceFrameAtSample(1_838, FILM, 44_100), 1);
	assert.equal(sequenceFrameAtSample(3_674, FILM, 44_100), 1);
	assert.equal(sequenceFrameAtSample(3_675, FILM, 44_100), 2);
});

test('containment holds at every boundary of a fractional rate', () => {
	for (const [rate, sampleRate] of [[NTSC, 48_000], [FILM, 44_100], [PAL, 44_100]] as const) {
		for (let frame = 0; frame < 400; frame += 1) {
			const start = sequenceFrameBoundarySample(frame, rate, sampleRate);
			const end = sequenceFrameBoundarySample(frame + 1, rate, sampleRate);
			assert.ok(end > start, `empty frame ${String(frame)}`);
			assert.equal(sequenceFrameAtSample(start, rate, sampleRate), frame);
			assert.equal(sequenceFrameAtSample(end - 1, rate, sampleRate), frame);
		}
	}
});

test('snapping honours explicit direction and leaves boundaries untouched', () => {
	assert.equal(snapSampleToSequenceFrame(1_838, FILM, 44_100, 'previous'), 1_838);
	assert.equal(snapSampleToSequenceFrame(1_838, FILM, 44_100, 'next'), 1_838);
	assert.equal(snapSampleToSequenceFrame(1_838, FILM, 44_100, 'nearest'), 1_838);
	assert.equal(snapSampleToSequenceFrame(2_000, FILM, 44_100, 'previous'), 1_838);
	assert.equal(snapSampleToSequenceFrame(2_000, FILM, 44_100, 'next'), 3_675);
	assert.equal(snapSampleToSequenceFrame(2_000, FILM, 44_100, 'nearest'), 1_838);
	assert.equal(snapSampleToSequenceFrame(3_000, FILM, 44_100, 'nearest'), 3_675);
	assert.throws(
		() => snapSampleToSequenceFrame(10, FILM, 44_100, 'sideways' as 'nearest'),
		/Unsupported sequence frame snap mode/,
	);
});

test('stepping resolves onto the boundary it moves toward', () => {
	assert.equal(stepSampleBySequenceFrames(0, 1, FILM, 44_100), 1_838);
	assert.equal(stepSampleBySequenceFrames(1_838, -1, FILM, 44_100), 0);
	assert.equal(stepSampleBySequenceFrames(2_000, 1, FILM, 44_100), 3_675);
	assert.equal(stepSampleBySequenceFrames(2_000, -1, FILM, 44_100), 1_838);
	assert.equal(stepSampleBySequenceFrames(0, -1, FILM, 44_100), 0);
	assert.equal(stepSampleBySequenceFrames(1_838, 10, FILM, 44_100), sequenceFrameBoundarySample(11, FILM, 44_100));
});

test('ten thousand steps never drift from the absolute origin', () => {
	let sample = 0;
	for (let step = 0; step < 10_000; step += 1) sample = stepSampleBySequenceFrames(sample, 1, FILM, 44_100);
	assert.equal(sample, sequenceFrameBoundarySample(10_000, FILM, 44_100));
	assert.equal(sample, 18_375_000);
	for (let step = 0; step < 10_000; step += 1) sample = stepSampleBySequenceFrames(sample, -1, FILM, 44_100);
	assert.equal(sample, 0);
});

test('a sequence view carries its label geometry and start offset', () => {
	const view = resolveSequenceTimingView(project({
		rate: NTSC,
		dropFrame: true,
		startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0 },
	}));
	assert.equal(view.id, 'main-sequence');
	assert.equal(view.nominalFrameRate, 30);
	assert.equal(view.startFrameCount, 107_892);
	assert.equal(sequenceTimecodeLabelAtSample(view, 0, 48_000), '01:00:00;00');
	assert.throws(() => resolveSequenceTimingView(project(), 'missing'), /Sequence missing is missing/);
});

test('sample positions and typed labels agree through the sequence view', () => {
	const view = resolveSequenceTimingView(project({ rate: PAL }));
	assert.equal(sequenceTimecodeLabelAtSample(view, 0, 48_000), '00:00:00:00');
	assert.equal(sequenceTimecodeLabelAtSample(view, 1_919, 48_000), '00:00:00:00');
	assert.equal(sequenceTimecodeLabelAtSample(view, 1_920, 48_000), '00:00:00:01');
	assert.equal(sampleAtSequenceTimecodeLabel(view, '00:00:01:00', 48_000), 48_000);
	assert.equal(sampleAtSequenceTimecodeLabel(view, '-00:00:01:00', 48_000), 0);
});

test('a start timecode offsets labels without moving a sample', () => {
	const view = resolveSequenceTimingView(project({
		rate: PAL,
		startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 10, frames: 0 },
	}));
	assert.equal(sequenceTimecodeLabelAtSample(view, 0, 48_000), '00:00:10:00');
	assert.equal(sampleAtSequenceTimecodeLabel(view, '00:00:11:00', 48_000), 48_000);
});
