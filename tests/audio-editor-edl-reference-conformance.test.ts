/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectEdlExport } from '../src/common/editor/edl-project-adapter.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';

/**
 * CMX3600 round trip through the reference reader.
 *
 * This is beyond 6C-1a's stated acceptance, which asked only that our own
 * conformance suite re-parse the list. It is here because the reference reader
 * was provisioned for OTIO anyway and reading our EDL with it costs nothing,
 * and because an EDL is the format most likely to be consumed by software that
 * has never heard of us.
 *
 * A CMX3600 list does not carry its own frame rate — FCM says drop or non-drop
 * and nothing more — so the reader is told the rate, exactly as a human
 * operator would tell their NLE. That is the format's nature, not a gap in what
 * we emit.
 */

const SAMPLE_RATE = 48_000;

function project(rate: { num: number; den: number }, dropFrame: boolean, durations: readonly number[]) {
	let position = 0;
	const clips = durations.map((durationFrames, index) => {
		const clip = {
			kind: 'video', id: `c${index}`, sourceId: 'src', title: `Clip ${index}`,
			timelineStartFrame: position, durationFrames, sourceStartFrame: index * 8_003, speedRatio: 1,
		};
		position += durationFrames;
		return clip;
	});
	return {
		id: 'p', title: 'Reference', sampleRate: SAMPLE_RATE, primarySequenceId: 'seq',
		sequences: [{
			id: 'seq', name: 'Seq', rate, dropFrame,
			startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0 },
		}],
		sources: [{ kind: 'video', id: 'src', name: 'CAM', storageKey: 'media/cam.mp4' }],
		clips,
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: clips.map((clip) => clip.id), hidden: false }],
	};
}

/**
 * Chosen so event boundaries land on frame numbers above 23 as well as below,
 * which is what makes the rate genuinely load-bearing: a list read at the wrong
 * rate then carries frame fields that rate cannot express.
 */
const DURATIONS = Object.freeze([40_000, 4_801, 44_099, 2_103]);

const CASES = Object.freeze([
	{ label: '24', rate: { num: 24, den: 1 }, dropFrame: false, readerRate: 24 },
	{ label: '25', rate: { num: 25, den: 1 }, dropFrame: false, readerRate: 25 },
	// The reader wants the exact double for 29.97, not 29.97 and not 30: it
	// validates the ';' divider against the rate and rejects both of those.
	{ label: '29.97 NDF', rate: { num: 30_000, den: 1_001 }, dropFrame: false, readerRate: 30_000 / 1_001 },
	{ label: '29.97 DF', rate: { num: 30_000, den: 1_001 }, dropFrame: true, readerRate: 30_000 / 1_001 },
	{ label: '30', rate: { num: 30, den: 1 }, dropFrame: false, readerRate: 30 },
]);

for (const { label, rate, dropFrame, readerRate } of CASES) {
	test(`at ${label} the reference CMX3600 reader accepts our list and agrees on every event`, () => {
		const result = createProjectEdlExport({ project: project(rate, dropFrame, DURATIONS) });
		const items = referenceItems(
			readWithReference(result.text, 'cmx_3600', { rate: readerRate }, '.edl'),
		);
		assert.equal(items.length, DURATIONS.length, 'every event must survive the round trip');

		// Durations are compared as frame counts, which is the one thing both
		// sides must agree on exactly: an event whose length changed in transit
		// is an edit that changed.
		let position = 0;
		for (const [index, durationFrames] of DURATIONS.entries()) {
			const expected = frameAt(position + durationFrames, rate) - frameAt(position, rate);
			assert.equal(
				items[index].durationValue,
				expected,
				`event ${index} at ${label} changed length between us and the reference reader`,
			);
			position += durationFrames;
		}
	});
}

test('the reference reader recovers the reel names we wrote', () => {
	const result = createProjectEdlExport({
		project: project({ num: 25, den: 1 }, false, DURATIONS),
		reelNames: { src: 'TAPE042' },
	});
	const text = readWithReference(result.text, 'cmx_3600', { rate: 25 }, '.edl');
	assert.ok(text.length > 0, 'the reader produced a timeline');
	assert.match(result.text, /TAPE042/u);
});

test('a list whose events we omitted is still a list the reference reader accepts', () => {
	// The omission path is the one most likely to emit something malformed,
	// because it is the path that writes fewer events than the project has clips.
	const withBlink = project({ num: 30_000, den: 1_001 }, false, DURATIONS);
	const blink = {
		kind: 'video', id: 'blink', sourceId: 'src', title: 'Blink',
		timelineStartFrame: 0, durationFrames: 7, sourceStartFrame: 0, speedRatio: 1,
	};
	const mutated = {
		...withBlink,
		clips: [blink, ...withBlink.clips],
		tracks: [{ ...withBlink.tracks[0], clipIds: ['blink', ...withBlink.tracks[0].clipIds] }],
	};
	const result = createProjectEdlExport({ project: mutated });
	assert.ok(result.report.items.some((item) => item.code === 'edl.sub-frame-clip-omitted'));
	const items = referenceItems(readWithReference(result.text, 'cmx_3600', { rate: 30 }, '.edl'));
	assert.equal(items.length, DURATIONS.length, 'the remaining events are intact and readable');
});

test('the reference reader rejects a list at the wrong rate, so these tests are not vacuous', () => {
	// If the reader accepted anything, the assertions above would prove nothing.
	// A 30fps list read as 24fps carries frame numbers 24 cannot express.
	const result = createProjectEdlExport({ project: project({ num: 30, den: 1 }, false, DURATIONS) });
	assert.match(result.text, /:2[4-9]\b/u, 'the list must contain a frame number 24 cannot express');
	assert.throws(
		() => readWithReference(result.text, 'cmx_3600', { rate: 24 }, '.edl'),
		/rejected our output/u,
	);
});

function frameAt(sampleFrame: number, rate: { num: number; den: number }): number {
	const floored = Math.floor((sampleFrame * rate.num) / (SAMPLE_RATE * rate.den));
	const boundary = (frame: number) => Math.round((frame * rate.den * SAMPLE_RATE) / rate.num);
	return boundary(floored + 1) <= sampleFrame ? floored + 1 : floored;
}
