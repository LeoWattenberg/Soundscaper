/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createOtioExport } from '../src/common/editor/otio-export.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';

/**
 * 6C-1b acceptance: round trip through the reference OTIO implementation.
 *
 * The in-tree conformance suite proves our file is self-consistent. It cannot
 * prove upstream agrees with us, and those are different claims — a writer and
 * its own reader can share a misunderstanding indefinitely. Here the reader is
 * OpenTimelineIO itself, provisioned by
 * `scripts/provision-interchange-conformance.mjs`.
 *
 * The acceptance names 29.97 and 59.94 specifically, because those are the
 * rates where a frame goes missing if anything in the chain rounds.
 */

const SAMPLE_RATE = 48_000;

const RATES = Object.freeze([
	{ label: '29.97', num: 30_000, den: 1_001 },
	{ label: '59.94', num: 60_000, den: 1_001 },
	{ label: '25', num: 25, den: 1 },
	{ label: '23.976', num: 24_000, den: 1_001 },
]);

/**
 * Not round seconds: durations landing mid-frame are where loss would show.
 * Every one exceeds 2002 samples, which is one frame at the slowest rate tested
 * (23.976), so each clip is representable at every rate. A shorter clip is a
 * legitimate omission rather than a lost frame, and has its own test below.
 */
const DURATIONS = Object.freeze([SAMPLE_RATE, 4_801, 44_099, 2_103, SAMPLE_RATE * 3 + 13]);

function project(durations: readonly number[]) {
	let position = 0;
	const clips = durations.map((durationFrames, index) => {
		const clip = {
			kind: 'video', id: `c${index}`, sourceId: 'src', title: `Clip ${index}`,
			timelineStartFrame: position, durationFrames, sourceStartFrame: index * 4_001, speedRatio: 1,
		};
		position += durationFrames;
		return clip;
	});
	return {
		id: 'p', title: 'Reference', sampleRate: SAMPLE_RATE,
		sources: [{ kind: 'video', id: 'src', name: 'CAM', storageKey: 'media/cam.mp4' }],
		clips,
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: clips.map((clip) => clip.id), hidden: false }],
	};
}

function readBack(text: string) {
	return readWithReference(text, 'otio_json', {}, '.otio');
}

for (const { label, num, den } of RATES) {
	test(`at ${label} OpenTimelineIO reads back every frame boundary we wrote`, () => {
		const result = createOtioExport({ project: project(DURATIONS), sequenceRate: { num, den } });
		const items = referenceItems(readBack(result.text));

		assert.equal(items.length, DURATIONS.length, 'the reference reader must find every clip');

		// Recompute the expected spans independently of both our writer and the
		// reader, from the sample positions the project actually holds.
		let position = 0;
		let previousEnd = 0;
		for (const [index, durationFrames] of DURATIONS.entries()) {
			const startFrame = frameAt(position, num, den);
			const endFrame = frameAt(position + durationFrames, num, den);
			assert.equal(
				items[index].durationValue,
				endFrame - startFrame,
				`clip ${index} at ${label} lost frames somewhere between us and the reference reader`,
			);
			assert.equal(startFrame, previousEnd, `clip ${index} at ${label} must abut its predecessor`);
			assert.ok(
				Math.abs(items[index].durationRate - num / den) < 1e-9,
				'the reference reader must recover the rate we wrote',
			);
			previousEnd = endFrame;
			position += durationFrames;
		}
	});
}

test('the reference reader recovers the sequence start we wrote', () => {
	const result = createOtioExport({
		project: project([SAMPLE_RATE]),
		sequenceRate: { num: 30_000, den: 1_001 },
		startFrameCount: 107_892,
	});
	const [timeline] = readBack(result.text);
	assert.equal(timeline.globalStartValue, 107_892, 'one hour at 29.97, intact after the round trip');
	assert.equal(timeline.name, 'Reference');
});

test('the reference reader sees audio in samples and video in sequence frames', () => {
	// One timebase per item is a rule about the file, so the check belongs on
	// the far side of a reader that had no idea what we intended.
	const withAudio = {
		...project([SAMPLE_RATE]),
		sources: [
			{ kind: 'video', id: 'src', name: 'CAM', storageKey: 'media/cam.mp4' },
			{ kind: 'audio', id: 'aud', name: 'MIX', storageKey: 'media/mix.wav' },
		],
		clips: [
			{
				kind: 'video', id: 'c0', sourceId: 'src', title: 'Picture',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'audio', id: 'a0', sourceId: 'aud', title: 'Sound',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
		],
		tracks: [
			{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c0'], hidden: false },
			{ type: 'audio', id: 'a1', name: 'A1', clipIds: ['a0'], mute: false },
		],
	};
	const result = createOtioExport({ project: withAudio, sequenceRate: { num: 30_000, den: 1_001 } });
	const [timeline] = readBack(result.text);
	const video = timeline.tracks.find((track) => track.kind === 'Video');
	const audio = timeline.tracks.find((track) => track.kind === 'Audio');
	assert.ok(video && audio, 'the reference reader must see both track kinds');
	assert.ok(Math.abs(video.items[0].durationRate - 30_000 / 1_001) < 1e-9);
	assert.equal(audio.items[0].durationRate, SAMPLE_RATE);
	assert.equal(audio.items[0].durationValue, SAMPLE_RATE, 'one second of audio is 48000 samples');
});

test('a gap we wrote is a gap the reference reader sees, in the right place', () => {
	const spaced = {
		...project([SAMPLE_RATE]),
		clips: [{
			kind: 'video', id: 'c0', sourceId: 'src', title: 'Late',
			timelineStartFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
		}],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c0'], hidden: false }],
	};
	const result = createOtioExport({ project: spaced, sequenceRate: { num: 30_000, den: 1_001 } });
	const items = referenceItems(readBack(result.text));
	assert.equal(items[0].schema, 'Gap');
	assert.equal(items[0].durationValue, 29, 'the silence before the clip, in whole frames');
	assert.equal(items[1].schema, 'Clip');
});

/** The project's own conversion, restated here so the test does not import the writer's. */
function frameAt(sampleFrame: number, num: number, den: number): number {
	const exact = (sampleFrame * num) / (SAMPLE_RATE * den);
	const floored = Math.floor(exact);
	// Match `point` rounding: the boundary sample of frame n is round(n*den*SR/num).
	return boundary(floored + 1, num, den) <= sampleFrame ? floored + 1 : floored;
}

function boundary(frame: number, num: number, den: number): number {
	return Math.round((frame * den * SAMPLE_RATE) / num);
}

test('a sub-frame clip is absent to the reference reader too, and reported by us', () => {
	// Our exporter omits it because it has no representable duration. The
	// reference reader agreeing it is not there is the confirmation that we
	// omitted a clip rather than silently corrupted the timeline around it.
	const blink = {
		...project([SAMPLE_RATE]),
		clips: [
			{
				kind: 'video', id: 'keep', sourceId: 'src', title: 'Keep',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'video', id: 'blink', sourceId: 'src', title: 'Blink',
				timelineStartFrame: SAMPLE_RATE, durationFrames: 7, sourceStartFrame: 0, speedRatio: 1,
			},
		],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['keep', 'blink'], hidden: false }],
	};
	const result = createOtioExport({ project: blink, sequenceRate: { num: 30_000, den: 1_001 } });
	const items = referenceItems(readBack(result.text));
	assert.deepEqual(items.map((entry) => entry.name), ['Keep'], 'only the representable clip survives');
	assert.ok(result.report.items.some((entry) => entry.code === 'otio.sub-frame-clip-omitted'));
});
