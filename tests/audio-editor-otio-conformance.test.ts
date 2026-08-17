/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createOtioExport } from '../src/common/editor/otio-export.ts';

/**
 * OTIO conformance: the tolerance-vs-exact split.
 *
 * The milestone-3 rules allow tolerance in exactly one place and demand
 * exactness everywhere else, so this suite asserts both halves rather than
 * applying one epsilon uniformly:
 *
 * - **Exact:** structure, schema strings, and every integer frame or sample
 *   value. These are compared with strict equality, because a frame count that
 *   is "close" is a frame that moved.
 * - **Tolerance:** the emitted `rate` double alone, which cannot represent
 *   30000/1001 and is only required to be the nearest double to it.
 *
 * What this suite is not: a round trip through the reference OTIO
 * implementation. That check needs the `opentimelineio` package provisioned,
 * which is an external dependency decision and is recorded as outstanding in
 * the 6C pickup. The reader below is independent of the writer, so it proves
 * the emitted file is self-consistent and frame-exact; it cannot prove
 * upstream agrees.
 */

const SAMPLE_RATE = 48_000;

/** The two rates the acceptance names, plus their exact rationals. */
const RATES = Object.freeze([
	{ label: '29.97', num: 30_000, den: 1_001 },
	{ label: '59.94', num: 60_000, den: 1_001 },
]);

/**
 * Deliberately not round seconds: durations that land mid-frame are the risk.
 * Every one spans at least a frame at 59.94; a shorter clip has no representable
 * duration at all and is covered by its own omission test instead.
 */
const CLIP_DURATIONS = Object.freeze([SAMPLE_RATE, 1_601, 44_099, 803, SAMPLE_RATE * 3 + 13]);

function project(durations: readonly number[]) {
	let position = 0;
	const clips = durations.map((durationFrames, index) => {
		const clip = {
			kind: 'video', id: `c${index}`, sourceId: 'src', title: `Clip ${index}`,
			timelineStartFrame: position, durationFrames, sourceStartFrame: index * 1_000, speedRatio: 1,
		};
		position += durationFrames;
		return clip;
	});
	return {
		id: 'p', title: 'Conformance', sampleRate: SAMPLE_RATE,
		sources: [{ kind: 'video', id: 'src', name: 'CAM', storageKey: 'media/cam.mp4' }],
		clips,
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: clips.map((clip) => clip.id), hidden: false }],
	};
}

/** An independent reader: walks the JSON without touching the writer's helpers. */
function readTrackItems(text: string): { schema: string; start: number; duration: number; rate: number }[] {
	const document = JSON.parse(text);
	assert.equal(document.OTIO_SCHEMA, 'Timeline.1');
	assert.equal(document.tracks.OTIO_SCHEMA, 'Stack.1');
	const [track] = document.tracks.children;
	assert.equal(track.OTIO_SCHEMA, 'Track.1');
	return track.children.map((child: Record<string, never>) => {
		const range = child.source_range as unknown as {
			start_time: { value: number; rate: number }; duration: { value: number; rate: number };
		};
		assert.equal(range.start_time.rate, range.duration.rate, 'one timebase per item');
		return {
			schema: String(child.OTIO_SCHEMA),
			start: range.start_time.value,
			duration: range.duration.value,
			rate: range.duration.rate,
		};
	});
}

for (const { label, num, den } of RATES) {
	test(`at ${label} every frame boundary is exact and no frame is lost`, () => {
		const result = createOtioExport({
			project: project(CLIP_DURATIONS), sequenceRate: { num, den },
		});
		const items = readTrackItems(result.text);
		assert.equal(items.length, CLIP_DURATIONS.length, 'contiguous clips need no gaps between them');

		// The exact half: recompute each boundary from the rational rate and
		// require strict equality. Any drift is a frame that moved.
		let samplePosition = 0;
		let expectedStart = 0;
		for (const [index, durationFrames] of CLIP_DURATIONS.entries()) {
			const startFrame = Math.floor((samplePosition * num) / (SAMPLE_RATE * den));
			const endFrame = Math.floor(((samplePosition + durationFrames) * num) / (SAMPLE_RATE * den));
			assert.equal(items[index].schema, 'Clip.1');
			assert.equal(
				items[index].duration,
				endFrame - startFrame,
				`clip ${index} at ${label} must carry its exact frame span`,
			);
			assert.ok(Number.isInteger(items[index].start), 'a fractional value truncates downstream');
			assert.equal(startFrame, expectedStart, `clip ${index} at ${label} must abut its predecessor`);
			expectedStart = endFrame;
			samplePosition += durationFrames;
		}

		// The tolerance half, and the only place it is permitted: the rate double.
		for (const item of items) {
			assert.ok(
				Math.abs(item.rate - num / den) < 1e-12,
				`the emitted rate must be the nearest double to ${num}/${den}`,
			);
		}
	});

	test(`at ${label} the timeline duration equals the sum of its items`, () => {
		// The property the reference round trip would check: nothing is lost
		// between the items and the whole.
		const result = createOtioExport({
			project: project(CLIP_DURATIONS), sequenceRate: { num, den },
		});
		const items = readTrackItems(result.text);
		const total = items.reduce((sum, item) => sum + item.duration, 0);
		const expected = Math.floor(
			(CLIP_DURATIONS.reduce((sum, value) => sum + value, 0) * num) / (SAMPLE_RATE * den),
		);
		assert.equal(total, expected, `frames went missing between the items and the whole at ${label}`);
	});
}

test('structure and schema strings compare exactly, with no tolerance anywhere near them', () => {
	const result = createOtioExport({ project: project([SAMPLE_RATE]), sequenceRate: { num: 30_000, den: 1_001 } });
	const document = JSON.parse(result.text);
	assert.equal(document.OTIO_SCHEMA, 'Timeline.1');
	assert.equal(document.tracks.OTIO_SCHEMA, 'Stack.1');
	assert.equal(document.tracks.children[0].OTIO_SCHEMA, 'Track.1');
	assert.equal(document.tracks.children[0].kind, 'Video');
	assert.equal(document.tracks.children[0].children[0].OTIO_SCHEMA, 'Clip.1');
	assert.equal(document.tracks.children[0].children[0].media_reference.OTIO_SCHEMA, 'ExternalReference.1');
	assert.equal(document.global_start_time.OTIO_SCHEMA, 'RationalTime.1');
});

test('serialization is deterministic, so a fixture can pin its bytes', () => {
	const build = () => createOtioExport({
		project: project(CLIP_DURATIONS), sequenceRate: { num: 30_000, den: 1_001 }, title: 'Fixed',
	}).text;
	assert.equal(build(), build());
});
