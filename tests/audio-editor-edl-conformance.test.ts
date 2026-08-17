/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEdlExport, type EdlEvent } from '../src/common/editor/edl-export.ts';
import {
	parseSequenceTimecode,
	sequenceTimecodeToFrameCount,
	type SequenceRationalRate,
} from '../src/common/editor/sequence-timecode.ts';

/**
 * Conformance for the CMX3600 profile.
 *
 * The re-parse below is deliberately independent of the writer: it reads the
 * emitted text with its own line grammar rather than reusing anything the
 * exporter used to produce it. A round-trip that shares the writer's code
 * proves only that the code agrees with itself.
 */

const RATES: readonly { label: string; rate: SequenceRationalRate; dropFrame: boolean }[] = Object.freeze([
	{ label: '23.976', rate: { num: 24_000, den: 1_001 }, dropFrame: false },
	{ label: '24', rate: { num: 24, den: 1 }, dropFrame: false },
	{ label: '25', rate: { num: 25, den: 1 }, dropFrame: false },
	{ label: '29.97DF', rate: { num: 30_000, den: 1_001 }, dropFrame: true },
	{ label: '29.97NDF', rate: { num: 30_000, den: 1_001 }, dropFrame: false },
	{ label: '30', rate: { num: 30, den: 1 }, dropFrame: false },
]);

/**
 * Boundaries chosen to sit either side of the drop-frame skips: minute 1 is the
 * first minute that drops labels and minute 10 is the one that does not.
 */
function events(): readonly EdlEvent[] {
	return Object.freeze([
		{ reel: 'TAPE001', trackKind: 'V' as const, sourceInFrames: 0, sourceOutFrames: 1_800, recordInFrames: 0, recordOutFrames: 1_800, clipName: 'One' },
		{ reel: 'TAPE002', trackKind: 'V' as const, sourceInFrames: 1_798, sourceOutFrames: 3_600, recordInFrames: 1_800, recordOutFrames: 3_602, clipName: 'Two' },
		{ reel: 'TAPE003', trackKind: 'V' as const, sourceInFrames: 17_982, sourceOutFrames: 18_000, recordInFrames: 3_602, recordOutFrames: 3_620, clipName: 'Three' },
	]);
}

interface ParsedEvent {
	readonly number: string;
	readonly reel: string;
	readonly trackKind: string;
	readonly edit: string;
	readonly frames: readonly number[];
}

/** An independent CMX3600 reader: the FCM line, then one line per event. */
function parseEdl(text: string, rate: SequenceRationalRate): {
	title: string; dropFrame: boolean; events: ParsedEvent[];
} {
	const lines = text.split('\n');
	const title = lines.find((line) => line.startsWith('TITLE: '))?.slice(7) ?? '';
	const fcm = lines.find((line) => line.startsWith('FCM: '))?.slice(5) ?? '';
	assert.ok(fcm === 'DROP FRAME' || fcm === 'NON-DROP FRAME', `unreadable FCM line: ${fcm}`);
	const dropFrame = fcm === 'DROP FRAME';
	const parsed: ParsedEvent[] = [];
	for (const line of lines) {
		if (!/^\d{3} /u.test(line)) continue;
		const fields = line.trim().split(/\s+/u);
		assert.equal(fields.length, 8, `a CMX3600 event line carries eight fields: ${line}`);
		const [number, reel, trackKind, edit, ...timecodes] = fields;
		parsed.push({
			number,
			reel,
			trackKind,
			edit,
			frames: timecodes.map((value) => sequenceTimecodeToFrameCount(
				parseSequenceTimecode(value, rate, dropFrame), rate, dropFrame,
			)),
		});
	}
	return { title, dropFrame, events: parsed };
}

for (const { label, rate, dropFrame } of RATES) {
	test(`at ${label} every event boundary survives the round trip exactly`, () => {
		const source = events();
		const result = createEdlExport({ title: 'Conformance', rate, dropFrame, events: source });
		const reparsed = parseEdl(result.text, rate);

		assert.equal(reparsed.title, 'Conformance');
		assert.equal(reparsed.dropFrame, dropFrame, 'the drop-frame flag is the sequence\'s, not the rate\'s');
		assert.equal(reparsed.events.length, source.length);

		for (const [index, event] of source.entries()) {
			assert.deepEqual(
				reparsed.events[index].frames,
				[event.sourceInFrames, event.sourceOutFrames, event.recordInFrames, event.recordOutFrames],
				`event ${index} at ${label} must re-read as the exact frames it was written from`,
			);
			assert.equal(reparsed.events[index].reel, event.reel);
			assert.equal(reparsed.events[index].edit, 'C', 'the profile emits cuts only');
		}
	});

	test(`at ${label} no emitted value is a decimal rate literal`, () => {
		const result = createEdlExport({ title: 'Conformance', rate, dropFrame, events: events() });
		assert.doesNotMatch(
			result.text,
			/\d+\.\d+/u,
			'a decimal in an EDL is a rate that has already lost its exactness',
		);
		assert.equal(
			result.report.items.find((item) => item.code === 'edl.events-preserved')?.data.rate,
			`${rate.num}/${rate.den}`,
			'the report records the exact rational the list was written at',
		);
	});
}

test('drop frame is refused at rates where it has no meaning', () => {
	for (const rate of [{ num: 25, den: 1 }, { num: 24, den: 1 }, { num: 24_000, den: 1_001 }]) {
		assert.throws(
			() => createEdlExport({ title: 'X', rate, dropFrame: true, events: events() }),
			/Drop frame is illegal/u,
			`drop frame must not be accepted at ${rate.num}/${rate.den}`,
		);
	}
});

test('the drop-frame and non-drop lists at 29.97 label the same frames differently', () => {
	// Same frame counts, different labels: proof the flag reaches the formatter
	// rather than being inferred from the rate and quietly ignored.
	const rate = { num: 30_000, den: 1_001 };
	const drop = createEdlExport({ title: 'X', rate, dropFrame: true, events: events() });
	const nonDrop = createEdlExport({ title: 'X', rate, dropFrame: false, events: events() });
	assert.notEqual(drop.text, nonDrop.text);
	assert.ok(drop.text.includes('FCM: DROP FRAME'));
	assert.ok(nonDrop.text.includes('FCM: NON-DROP FRAME'));
});
