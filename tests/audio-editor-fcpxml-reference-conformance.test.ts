/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFcpxmlExport } from '../src/common/editor/fcpxml-export.ts';
import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';

/**
 * FCPXML round trip through a third-party reader.
 *
 * 6C-1c's acceptance asked for validation against a pinned FCPXML DTD. Apple's
 * DTD is not redistributable, so this suite gets the same assurance a different
 * way: our file is parsed by the `otio-fcpx-xml-adapter` reference reader and
 * every structural fact we claim is checked from the far side of it.
 *
 * ONE KNOWN LIMITATION, WHICH IS THE READER'S AND NOT OURS. The adapter derives
 * the sequence rate like this (fcpx_xml.py, `_format_frame_rate`):
 *
 *     return int(float(fd_rate) / float(fd_total))
 *
 * For `frameDuration="1001/30000s"` that is `int(29.97002997…)` — 29. The
 * truncation loses every NTSC rate: 29.97 becomes 29, 23.976 becomes 23, 59.94
 * becomes 59, and the frame counts computed from our exact rational times then
 * come out short with a phantom gap where a clip no longer abuts its neighbour.
 *
 * `1001/30000s` is precisely how FCPXML expresses 29.97 and precisely what Final
 * Cut Pro itself writes, so our output is correct and must not be contorted to
 * satisfy an integer-only reader. The NTSC case is therefore asserted as a
 * *known reader limitation* rather than skipped: if the adapter is ever fixed,
 * that test fails and tells us to strengthen this suite.
 */

const SAMPLE_RATE = 48_000;

/** Rates where the reader's integer truncation is a no-op, so the check is meaningful. */
const EXACT_RATES = Object.freeze([
	{ label: '24', num: 24, den: 1 },
	{ label: '25', num: 25, den: 1 },
	{ label: '30', num: 30, den: 1 },
	{ label: '50', num: 50, den: 1 },
	{ label: '60', num: 60, den: 1 },
]);

function project() {
	return {
		id: 'p', title: 'Reference', sampleRate: SAMPLE_RATE,
		sources: [
			{ kind: 'video', id: 'src', name: 'CAM', storageKey: 'media/cam.mp4' },
			{ kind: 'video', id: 'other', name: 'CAM B', storageKey: 'media/cam-b.mp4' },
		],
		clips: [
			{
				kind: 'video', id: 'c0', sourceId: 'src', title: 'A',
				timelineStartFrame: 0, durationFrames: SAMPLE_RATE, sourceStartFrame: 0, speedRatio: 1,
			},
			{
				kind: 'video', id: 'c1', sourceId: 'src', title: 'B',
				timelineStartFrame: SAMPLE_RATE, durationFrames: SAMPLE_RATE * 2,
				sourceStartFrame: SAMPLE_RATE * 5, speedRatio: 1,
			},
			{
				kind: 'video', id: 'c2', sourceId: 'other', title: 'C',
				timelineStartFrame: SAMPLE_RATE * 3, durationFrames: SAMPLE_RATE,
				sourceStartFrame: SAMPLE_RATE, speedRatio: 1,
			},
		],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c0', 'c1', 'c2'], hidden: false }],
	};
}

function readBack(text: string) {
	return referenceItems(readWithReference(text, 'fcpx_xml', {}, '.fcpxml'));
}

for (const { label, num, den } of EXACT_RATES) {
	test(`at ${label} the reference FCPXML reader recovers our timeline exactly`, () => {
		const result = createFcpxmlExport({ project: project(), sequenceRate: { num, den } });
		const items = readBack(result.text);
		const perSecond = num / den;

		assert.deepEqual(
			items.map((item) => ({ schema: item.schema, name: item.name })),
			[
				{ schema: 'Clip', name: 'A' },
				{ schema: 'Clip', name: 'B' },
				{ schema: 'Clip', name: 'C' },
			],
			'three contiguous clips and no invented gaps',
		);
		assert.deepEqual(
			items.map((item) => item.durationValue),
			[perSecond, perSecond * 2, perSecond],
			`durations at ${label} must survive the round trip as whole frames`,
		);
		assert.deepEqual(
			items.map((item) => item.startValue),
			[0, perSecond * 5, perSecond],
			'the source in-points we wrote are the ones the reader recovers',
		);
		for (const item of items) {
			assert.equal(item.durationRate, perSecond, 'the reader must recover the rate we declared');
		}
	});
}

test('the reader resolves our deduplicated assets rather than losing a reference', () => {
	// Two of the three clips share one source. Asset deduplication is only
	// correct if a reader still resolves every clip to media.
	const result = createFcpxmlExport({ project: project(), sequenceRate: { num: 25, den: 1 } });
	assert.equal((result.text.match(/<asset id=/gu) ?? []).length, 2, 'two sources, two assets');
	assert.equal(readBack(result.text).length, 3, 'three clips still resolve');
});

test('we write the sequence start timecode even though this reader discards it', () => {
	// The adapter has no tcStart code path at all — grep it for `tcStart` and
	// nothing comes back — so it reports no global start for any FCPXML file,
	// ours included. That is a second reader limitation rather than a gap in
	// what we emit, and dropping tcStart to match it would corrupt every file
	// for readers that do honour it.
	const result = createFcpxmlExport({
		project: project(), sequenceRate: { num: 25, den: 1 }, startFrameCount: 90_000,
	});
	assert.match(result.text, /tcStart="3600s"/u, '90000 frames at 25fps is exactly one hour');
	const [timeline] = readWithReference(result.text, 'fcpx_xml', {}, '.fcpxml');
	assert.equal(
		timeline.globalStartValue,
		null,
		'when this reader learns to read tcStart, tighten this to assert 90000',
	);
});

test('a clip we omitted is absent to the reader, and the rest is undamaged', () => {
	const blink = {
		...project(),
		clips: [
			...project().clips,
			{
				kind: 'video', id: 'blink', sourceId: 'src', title: 'Blink',
				timelineStartFrame: SAMPLE_RATE * 4, durationFrames: 7, sourceStartFrame: 0, speedRatio: 1,
			},
		],
		tracks: [{ type: 'video', id: 'v1', name: 'V1', clipIds: ['c0', 'c1', 'c2', 'blink'], hidden: false }],
	};
	const result = createFcpxmlExport({ project: blink, sequenceRate: { num: 25, den: 1 } });
	assert.ok(result.report.items.some((item) => item.code === 'fcpxml.sub-frame-clip-omitted'));
	assert.deepEqual(readBack(result.text).map((item) => item.name), ['A', 'B', 'C']);
});

test('the NTSC misread is the reader truncating the rate, not us emitting a wrong one', () => {
	// This pins a known third-party limitation. `1001/30000s` is exactly how
	// FCPXML expresses 29.97 and exactly what Final Cut Pro writes, so the fix
	// is never to change what we emit. If this test starts failing, the adapter
	// has been fixed and the NTSC rates belong in EXACT_RATES above.
	const result = createFcpxmlExport({ project: project(), sequenceRate: { num: 30_000, den: 1_001 } });
	assert.match(
		result.text,
		/frameDuration="1001\/30000s"/u,
		'our file states the exact rational, which is the correct FCPXML for 29.97',
	);
	const items = readBack(result.text);
	assert.equal(
		items[0].durationRate,
		29,
		'the reader truncates int(30000/1001) to 29; when this changes, widen this suite',
	);
	assert.ok(
		items.some((item) => item.schema === 'Gap'),
		'the truncated rate is what makes clips stop abutting, producing a gap we never wrote',
	);
});
