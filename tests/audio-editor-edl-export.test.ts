/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEdlExport } from '../src/common/editor/edl-export.ts';
import {
	parseSequenceTimecode,
	sequenceTimecodeToFrameCount,
} from '../src/common/editor/sequence-timecode.ts';

const RATE_24 = { num: 24, den: 1 };
const RATE_2997 = { num: 30_000, den: 1_001 };

function event(overrides: Record<string, unknown> = {}) {
	return {
		reel: 'TAPE01',
		trackKind: 'V' as const,
		sourceInFrames: 0,
		sourceOutFrames: 48,
		recordInFrames: 0,
		recordOutFrames: 48,
		...overrides,
	};
}

test('a cut list emits numbered events with source and record timecode', () => {
	const result = createEdlExport({
		title: 'Reel One', rate: RATE_24,
		events: [event({ clipName: 'Opening' }), event({
			reel: 'TAPE02', sourceInFrames: 96, sourceOutFrames: 144,
			recordInFrames: 48, recordOutFrames: 96,
		})],
	});
	const lines = result.text.trimEnd().split('\n');
	assert.equal(lines[0], 'TITLE: Reel One');
	assert.equal(lines[1], 'FCM: NON-DROP FRAME');
	assert.match(lines[2], /^001 TAPE01 {3}V C\s+00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00$/u);
	assert.equal(lines[3], '* FROM CLIP NAME: Opening');
	assert.match(lines[4], /^002 TAPE02   V C/u);
	assert.equal(result.fileName, 'Reel-One.edl');
	assert.equal(result.mimeType, 'text/plain');
});

test('drop frame is a sequence flag, signalled in FCM and the separator', () => {
	const nonDrop = createEdlExport({ title: 'T', rate: RATE_2997, events: [event()] });
	assert.match(nonDrop.text, /FCM: NON-DROP FRAME/u);
	assert.match(nonDrop.text, /00:00:00:00/u);

	const drop = createEdlExport({ title: 'T', rate: RATE_2997, dropFrame: true, events: [event()] });
	assert.match(drop.text, /FCM: DROP FRAME/u);
	assert.match(drop.text, /00:00:00;00/u, 'drop frame labels use a semicolon');
});

test('drop frame at a rate that cannot carry it is refused, not quietly dropped', () => {
	assert.throws(
		() => createEdlExport({ title: 'T', rate: RATE_24, dropFrame: true, events: [event()] }),
		/Drop frame is illegal at 24\/1/u,
	);
});

test('emitted timecode round-trips through the shared parser at every rate', () => {
	for (const [rate, dropFrame] of [
		[{ num: 24_000, den: 1_001 }, false],
		[RATE_24, false],
		[{ num: 25, den: 1 }, false],
		[RATE_2997, false],
		[RATE_2997, true],
		[{ num: 30, den: 1 }, false],
		[{ num: 60_000, den: 1_001 }, true],
	] as Array<[{ num: number; den: number }, boolean]>) {
		const frames = 12_345;
		const result = createEdlExport({
			title: 'T', rate, dropFrame,
			events: [event({ recordInFrames: frames, recordOutFrames: frames + 24, sourceInFrames: frames, sourceOutFrames: frames + 24 })],
		});
		const label = result.text.trimEnd().split('\n')[2].split(' ').at(-2);
		assert.equal(
			sequenceTimecodeToFrameCount(parseSequenceTimecode(String(label), rate, dropFrame), rate, dropFrame),
			frames,
			`round trip failed at ${rate.num}/${rate.den}${dropFrame ? ' DF' : ''}`,
		);
	}
});

test('no rate is ever emitted or compared as a decimal literal', () => {
	const result = createEdlExport({ title: 'T', rate: RATE_2997, events: [event()] });
	assert.doesNotMatch(result.text, /29\.97/u);
	const preserved = result.report.items.find(({ code }) => code === 'edl.events-preserved');
	assert.equal(preserved?.data.rate, '30000/1001', 'the report carries the exact quotient');
});

test('a transition and a speed change are itemized rather than approximated', () => {
	const result = createEdlExport({
		title: 'T', rate: RATE_24,
		events: [event({ transition: 'cross-dissolve', speedRatio: 0.5 })],
	});
	const codes = result.report.items.map(({ code }) => code);
	assert.ok(codes.includes('edl.transition-omitted'));
	assert.ok(codes.includes('edl.speed-change-omitted'));
	assert.equal(result.report.counts.omitted, 2);
	assert.match(result.text, / C /u, 'the event is still emitted, as a cut');
});

test('an over-long reel is truncated to eight characters and reported', () => {
	const result = createEdlExport({
		title: 'T', rate: RATE_24,
		events: [event({ reel: 'VERY-LONG-REEL-NAME' })],
	});
	const item = result.report.items.find(({ code }) => code === 'edl.reel-truncated');
	assert.ok(item);
	assert.equal(item.disposition, 'converted');
	assert.equal(item.data.to, 'VERY_LON');
	assert.match(result.text, /^001 VERY_LON V C/mu);
});

test('audio events carry their own track kind', () => {
	const result = createEdlExport({
		title: 'T', rate: RATE_24,
		events: [event({ trackKind: 'A' }), event({ trackKind: 'A2' })],
	});
	assert.match(result.text, /^001 TAPE01   A C/mu);
	assert.match(result.text, /^002 TAPE01   A2 C/mu);
});

test('an empty sequence still produces a valid header and says so', () => {
	const result = createEdlExport({ title: 'Empty', rate: RATE_24, events: [] });
	assert.equal(result.text, 'TITLE: Empty\nFCM: NON-DROP FRAME\n');
	const preserved = result.report.items.find(({ code }) => code === 'edl.events-preserved');
	assert.equal(preserved?.data.events, 0);
});

test('a malformed rate or frame count is refused', () => {
	assert.throws(() => createEdlExport({ title: 'T', rate: { num: 24, den: 0 }, events: [] }), /rational sequence rate/u);
	assert.throws(
		() => createEdlExport({ title: 'T', rate: RATE_24, events: [event({ recordInFrames: -1 })] }),
		/non-negative frame count/u,
	);
});
