/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SOURCE_MONITOR_NO_MARKS,
	clampSourceFrame,
	markSourceIn,
	markSourceOut,
	mediaSecondsToSourceFrame,
	resolveProgramFrame,
	resolveSourceMonitorPoints,
	sourceFrameToMediaSeconds,
	sourceMonitorTimecodeLabel,
	stepSourceFrame,
} from '../src/common/editor/source-monitor-model.ts';
import { resolveSourceTimecodeAtSample } from '../src/common/editor/source-properties-model.ts';

const PAL = Object.freeze({ num: 25, den: 1 });
const NTSC = Object.freeze({ num: 24_000, den: 1_001 });
const SAMPLE_RATE = 48_000;
const COUNT = 250;

test('a position stays on a frame the media actually has', () => {
	assert.equal(clampSourceFrame(0, COUNT), 0);
	assert.equal(clampSourceFrame(-5, COUNT), 0);
	assert.equal(clampSourceFrame(COUNT, COUNT), COUNT - 1, 'the last frame is one before the count');
	assert.equal(clampSourceFrame(12.9, COUNT), 12, 'a fractional position names the frame it is inside');
	assert.equal(stepSourceFrame(0, -1, COUNT), 0);
	assert.equal(stepSourceFrame(COUNT - 1, 1, COUNT), COUNT - 1);
	assert.equal(stepSourceFrame(10, 5, COUNT), 15);
	assert.throws(() => clampSourceFrame(0, 0), RangeError);
});

test('the out mark is exclusive, so marking a frame keeps that frame', () => {
	const marks = markSourceOut(SOURCE_MONITOR_NO_MARKS, 99, COUNT);
	assert.deepEqual(marks, { markIn: null, markOut: 100 });
	// 0..100 is a hundred frames, which is what the user marked while sitting on
	// frame 99 and asking to keep it.
	assert.deepEqual(resolveSourceMonitorPoints(marks, COUNT, 1), { sourceIn: 0, sourceOut: 100 });
});

test('the newest mark wins rather than the pair being swapped or refused', () => {
	const range = markSourceOut(markSourceIn(SOURCE_MONITOR_NO_MARKS, 40, COUNT), 99, COUNT);
	assert.deepEqual(range, { markIn: 40, markOut: 100 });

	// An in at or after the out cannot keep that out: swapping them would invent
	// a range nobody marked, and refusing would discard the newer mark.
	assert.deepEqual(markSourceIn(range, 150, COUNT), { markIn: 150, markOut: null });
	assert.deepEqual(markSourceIn(range, 99, COUNT), { markIn: 99, markOut: 100 }, 'one frame is still a range');
	assert.deepEqual(markSourceIn(range, 100, COUNT), { markIn: 100, markOut: null });

	// The same rule in the other direction.
	assert.deepEqual(markSourceOut(range, 20, COUNT), { markIn: null, markOut: 21 });
	assert.deepEqual(markSourceOut(range, 39, COUNT), { markIn: null, markOut: 40 });
	assert.deepEqual(markSourceOut(range, 40, COUNT), { markIn: 40, markOut: 41 });
});

test('marks the media can no longer hold are dropped rather than clamped', () => {
	// A re-read that shortened the media leaves a mark pointing past the end.
	// Dropping it asks the user to mark again; clamping would quietly move the
	// point they set to one they did not.
	assert.deepEqual(resolveSourceMonitorPoints({ markIn: 400, markOut: 450 }, COUNT, 1), {
		sourceIn: 0,
		sourceOut: COUNT,
	});
	assert.deepEqual(resolveSourceMonitorPoints({ markIn: 40, markOut: 40 }, COUNT, 1), {
		sourceIn: 0,
		sourceOut: COUNT,
	}, 'an empty pair is no pair');
});

test('the monitor states the marks it has and fills the rest from the media', () => {
	const cases: readonly [string, { markIn: number | null; markOut: number | null }, number, {
		sourceIn: number | null;
		sourceOut: number | null;
	}][] = [
		// With no marks and no selection width, the whole source supplies the
		// duration — which is exactly what 3B-3a edited with before marks existed.
		['nothing marked, playhead only', SOURCE_MONITOR_NO_MARKS, 1, { sourceIn: 0, sourceOut: COUNT }],
		['nothing marked, selection', SOURCE_MONITOR_NO_MARKS, 2, { sourceIn: 0, sourceOut: null }],
		['in only, playhead only', { markIn: 40, markOut: null }, 1, { sourceIn: 40, sourceOut: COUNT }],
		['in only, selection', { markIn: 40, markOut: null }, 2, { sourceIn: 40, sourceOut: null }],
		['out only, playhead only', { markIn: null, markOut: 90 }, 1, { sourceIn: 0, sourceOut: 90 }],
		// Backtimed: the sequence pair and the source out state three points, and
		// the source in is what the edit resolves.
		['out only, selection', { markIn: null, markOut: 90 }, 2, { sourceIn: null, sourceOut: 90 }],
		['both marked, playhead only', { markIn: 40, markOut: 90 }, 1, { sourceIn: 40, sourceOut: 90 }],
		// Four points. The resolver refuses them unless they agree, which is the
		// contract this slice deliberately does not paper over.
		['both marked, selection', { markIn: 40, markOut: 90 }, 2, { sourceIn: 40, sourceOut: 90 }],
	];
	for (const [name, marks, sequencePoints, expected] of cases) {
		assert.deepEqual(resolveSourceMonitorPoints(marks, COUNT, sequencePoints), expected, name);
	}
	assert.throws(() => resolveSourceMonitorPoints(SOURCE_MONITOR_NO_MARKS, COUNT, 0), RangeError);
	assert.throws(() => resolveSourceMonitorPoints(SOURCE_MONITOR_NO_MARKS, COUNT, 3), RangeError);
});

test('a media clock renders a frame and reads back as the same frame', () => {
	for (const rate of [PAL, NTSC]) {
		for (const frame of [0, 1, 23, 99, COUNT - 1]) {
			const seconds = sourceFrameToMediaSeconds(frame, rate);
			assert.equal(
				mediaSecondsToSourceFrame(seconds, rate, COUNT),
				frame,
				`${String(rate.num)}/${String(rate.den)} frame ${String(frame)}`,
			);
		}
	}
	// The clock lands in the middle of the frame, so a decoder rounding either
	// way still shows the frame that was asked for.
	assert.equal(sourceFrameToMediaSeconds(0, PAL), 0.02);
	assert.equal(mediaSecondsToSourceFrame(-1, PAL, COUNT), 0);
	assert.equal(mediaSecondsToSourceFrame(1_000, PAL, COUNT), COUNT - 1);
});

test('a source frame is labelled from its own recorded origin', () => {
	assert.equal(sourceMonitorTimecodeLabel(videoSource(), 100), '00:00:04:00');
	assert.equal(sourceMonitorTimecodeLabel(videoSource({
		characteristics: {
			backend: 'ffmpeg',
			startTimecode: { negative: false, hours: 10, minutes: 0, seconds: 0, frames: 0, dropFrame: false },
		},
	}), 102), '10:00:04:02');
});

test('the program frame names the clip under the playhead and its own range', () => {
	const frame = resolveProgramFrame(project(), { sample: SAMPLE_RATE * 12 / 25 });
	assert.ok(frame);
	assert.equal(frame.clipId, 'video-clip');
	assert.equal(frame.trackId, 'video-track');
	assert.equal(frame.sourceId, 'video-source');
	// Sequence frame 12 is the third frame of a clip that starts at 10 and takes
	// its media from source frame 100.
	assert.equal(frame.sourceFrame, 102);
	assert.equal(frame.sourceIn, 100);
	assert.equal(frame.sourceFrameCount, 50);
	assert.equal(frame.sequenceStartFrame, 10);
	assert.equal(frame.sequenceFrameCount, 50);
	// The sample range is derived from the clip's frames, never read from a
	// second placement authority.
	assert.equal(frame.startFrame, SAMPLE_RATE * 10 / 25);
	assert.equal(frame.endFrame, SAMPLE_RATE * 60 / 25);
});

test('a rate-stretched clip maps the program frame proportionally like playback', () => {
	// Uniform rate stretch persists sequenceFrameCount !== sourceFrameCount
	// with no retime map; playback resolves the drawn frame by progress, so
	// match-frame must name the same picture — not walk 1:1 past the clip's
	// own source range.
	const stretched = project({
		clips: [clip({
			sequenceStartFrame: 0, sequenceFrameCount: 100,
			sourceInFrame: 0, sourceFrameCount: 50,
		})],
	});
	const frame = resolveProgramFrame(stretched, { sample: SAMPLE_RATE * 80 / 25 });
	assert.ok(frame);
	assert.equal(frame.sourceFrame, 40, 'half speed shows source frame 40 at sequence frame 80');
});

test('nothing under the playhead is nothing, not the nearest clip', () => {
	assert.equal(resolveProgramFrame(project(), { sample: 0 }), null);
	assert.equal(resolveProgramFrame(project(), { sample: SAMPLE_RATE * 90 / 25 }), null);
	assert.equal(resolveProgramFrame(project(), { sample: 0, sequenceId: 'missing' }), null);
});

test('a targeted lane wins over document order under the same playhead', () => {
	const stacked = project({
		tracks: [
			{ id: 'video-track', type: 'video', clipIds: ['video-clip'] },
			{ id: 'upper-track', type: 'video', clipIds: ['upper-clip'] },
		],
		clips: [
			clip(),
			clip({ id: 'upper-clip', sourceInFrame: 200 }),
		],
	});
	assert.equal(
		resolveProgramFrame(stacked, { sample: SAMPLE_RATE * 12 / 25 })?.clipId,
		'video-clip',
		'document order decides when nothing is targeted',
	);
	assert.equal(
		resolveProgramFrame(stacked, { sample: SAMPLE_RATE * 12 / 25, videoTrackId: 'upper-track' })?.clipId,
		'upper-clip',
	);
	// A targeted lane holding nothing under the playhead does not suppress the
	// answer; it only loses its preference.
	assert.equal(
		resolveProgramFrame(stacked, { sample: SAMPLE_RATE * 12 / 25, videoTrackId: 'empty-track' })?.clipId,
		'video-clip',
	);
});

test('a clip on no track is not a program frame', () => {
	const orphaned = project({ tracks: [{ id: 'video-track', type: 'video', clipIds: [] }] });
	assert.equal(resolveProgramFrame(orphaned, { sample: SAMPLE_RATE * 12 / 25 }), null);
});

test('match-frame and the source timecode readout name the same frame', () => {
	// Two surfaces disagreeing about which frame of which source you are on is
	// the drift this milestone forbids, so the agreement is asserted rather than
	// assumed from having been written to the same rule.
	for (const rate of [PAL, NTSC]) {
		const document = project({
			sequences: [{ id: 'main', rate, dropFrame: false }],
			sources: [videoSource({ frameRate: rate })],
		});
		for (let sample = 0; sample < SAMPLE_RATE * 3; sample += 811) {
			const reading = resolveSourceTimecodeAtSample(document, sample);
			const frame = resolveProgramFrame(document, { sample });
			assert.equal(frame?.clipId ?? null, reading?.clipId ?? null, `clip at ${String(sample)}`);
			assert.equal(frame?.sourceFrame ?? null, reading?.sourceFrame ?? null, `frame at ${String(sample)}`);
			if (frame && reading) {
				assert.equal(
					sourceMonitorTimecodeLabel(videoSource({ frameRate: rate }), frame.sourceFrame),
					reading.label,
					`label at ${String(sample)}`,
				);
			}
		}
	}
});

function videoSource(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'video',
		id: 'video-source',
		name: 'Take 1',
		width: 1_920,
		height: 1_080,
		frameRate: PAL,
		sourceFrameCount: COUNT,
		timingDecision: { mode: 'exact', rate: PAL, backend: 'ffmpeg' },
		...overrides,
	};
}

function clip(overrides: Record<string, unknown> = {}) {
	return {
		kind: 'video',
		id: 'video-clip',
		sourceId: 'video-source',
		sequenceId: 'main',
		sequenceStartFrame: 10,
		sequenceFrameCount: 50,
		sourceInFrame: 100,
		sourceFrameCount: 50,
		...overrides,
	};
}

function project(overrides: Record<string, unknown> = {}) {
	return {
		sampleRate: SAMPLE_RATE,
		primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: PAL, dropFrame: false }],
		sources: [videoSource()],
		tracks: [{ id: 'video-track', type: 'video', clipIds: ['video-clip'] }],
		clips: [clip()],
		...overrides,
	};
}
