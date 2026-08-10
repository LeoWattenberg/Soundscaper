/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sequenceFrameBoundarySample } from '../src/common/editor/sequence-frame-navigation.ts';
import { resolveSequenceTimingView } from '../src/common/editor/sequence-timing-model.ts';
import {
	createSequenceRulerTicks,
	usesSequenceTimecodeDisplay,
} from '../src/common/editor/ui/timeline/sequence-ruler-model.ts';

const SAMPLE_RATE = 48_000;

function view(sequence: Record<string, unknown> = {}) {
	return resolveSequenceTimingView({
		sampleRate: SAMPLE_RATE,
		primarySequenceId: 'main',
		sequences: [{
			id: 'main',
			name: 'Main sequence',
			rate: { num: 25, den: 1 },
			dropFrame: false,
			startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
			...sequence,
		}],
	});
}

test('only a sequence-bearing project can display timecode', () => {
	assert.equal(usesSequenceTimecodeDisplay({ timeDisplay: { format: 'timecode' }, sequences: [{}] }), true);
	assert.equal(usesSequenceTimecodeDisplay({ timeDisplay: { format: 'timecode' }, sequences: [] }), false);
	assert.equal(usesSequenceTimecodeDisplay({ timeDisplay: { format: 'timecode' } }), false);
	assert.equal(usesSequenceTimecodeDisplay({ sequences: [{}] }), false);
});

test('a zoomed-in ruler labels single frames on their own boundaries', () => {
	const ticks = createSequenceRulerTicks({
		view: view(),
		sampleRate: SAMPLE_RATE,
		startFrame: 0,
		endFrame: 9_600,
		pixelsPerSample: 200 / SAMPLE_RATE * 25,
	});

	assert.deepEqual(
		ticks.filter((tick) => tick.major).map((tick) => [tick.sequenceFrame, tick.label]),
		[
			[0, '00:00:00:00'], [1, '00:00:00:01'], [2, '00:00:00:02'],
			[3, '00:00:00:03'], [4, '00:00:00:04'], [5, '00:00:00:05'],
		],
	);
	for (const tick of ticks) {
		assert.equal(tick.frame, sequenceFrameBoundarySample(tick.sequenceFrame, view().rate, SAMPLE_RATE));
	}
});

test('a zoomed-out ruler steps in whole seconds without unlabelled clutter', () => {
	const ticks = createSequenceRulerTicks({
		view: view(),
		sampleRate: SAMPLE_RATE,
		startFrame: 0,
		endFrame: SAMPLE_RATE * 10,
		pixelsPerSample: 100 / SAMPLE_RATE,
	});
	const major = ticks.filter((tick) => tick.major);

	assert.deepEqual(major.map((tick) => tick.label), [
		'00:00:00:00', '00:00:01:00', '00:00:02:00', '00:00:03:00', '00:00:04:00',
		'00:00:05:00', '00:00:06:00', '00:00:07:00', '00:00:08:00', '00:00:09:00',
		'00:00:10:00',
	]);
	assert.ok(ticks.length > major.length, 'minor ticks subdivide a legible second');
	assert.equal(major[1]?.frame, SAMPLE_RATE);
});

test('drop-frame ruler labels skip the labels the rate does not produce', () => {
	const dropFrame = view({ rate: { num: 30_000, den: 1_001 }, dropFrame: true });
	const start = sequenceFrameBoundarySample(1_795, dropFrame.rate, SAMPLE_RATE);
	const end = sequenceFrameBoundarySample(1_805, dropFrame.rate, SAMPLE_RATE);
	const ticks = createSequenceRulerTicks({
		view: dropFrame,
		sampleRate: SAMPLE_RATE,
		startFrame: start,
		endFrame: end,
		pixelsPerSample: 200 / SAMPLE_RATE * 30,
	});

	assert.deepEqual(
		ticks.filter((tick) => tick.sequenceFrame >= 1_799 && tick.sequenceFrame <= 1_801).map((tick) => tick.label),
		['00:00:59;29', '00:01:00;02', '00:01:00;03'],
	);
});

test('a start timecode offsets every label without moving a tick', () => {
	const offset = view({ startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0 } });
	const ticks = createSequenceRulerTicks({
		view: offset,
		sampleRate: SAMPLE_RATE,
		startFrame: 0,
		endFrame: 3_840,
		pixelsPerSample: 200 / SAMPLE_RATE * 25,
	});

	assert.deepEqual(ticks.map((tick) => [tick.frame, tick.label]), [
		[0, '01:00:00:00'], [1_920, '01:00:00:01'], [3_840, '01:00:00:02'],
	]);
});

test('the ruler stays bounded and rejects an inverted viewport', () => {
	const ticks = createSequenceRulerTicks({
		view: view(),
		sampleRate: SAMPLE_RATE,
		startFrame: 0,
		endFrame: SAMPLE_RATE * 4_000,
		pixelsPerSample: 4_000 / (SAMPLE_RATE * 4_000),
	});

	assert.ok(ticks.length > 0 && ticks.length <= 4_096);
	assert.throws(() => createSequenceRulerTicks({
		view: view(), sampleRate: SAMPLE_RATE, startFrame: 10, endFrame: 0,
	}), /endFrame cannot precede startFrame/);
});
