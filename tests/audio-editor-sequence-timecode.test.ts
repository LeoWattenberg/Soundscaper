/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SEQUENCE_DROP_FRAME_RATES,
	conformSequenceTimecode,
	formatSequenceTimecode,
	isLegalSequenceTimecode,
	isSequenceDropFrameRate,
	parseSequenceTimecode,
	sequenceTimecodeFrameRate,
	sequenceTimecodeFromFrameCount,
	sequenceTimecodeGeometry,
	sequenceTimecodeToFrameCount,
} from '../src/common/editor/sequence-timecode.ts';

const NTSC = { num: 30_000, den: 1_001 };
const NTSC_DOUBLE = { num: 60_000, den: 1_001 };
const FILM_NTSC = { num: 24_000, den: 1_001 };
const PAL = { num: 25, den: 1 };

test('the nominal label rate is the exact ceiling of the rational rate', () => {
	assert.equal(sequenceTimecodeFrameRate({ num: 30, den: 1 }), 30);
	assert.equal(sequenceTimecodeFrameRate(NTSC), 30);
	assert.equal(sequenceTimecodeFrameRate(NTSC_DOUBLE), 60);
	assert.equal(sequenceTimecodeFrameRate(FILM_NTSC), 24);
	assert.equal(sequenceTimecodeFrameRate(PAL), 25);
	assert.equal(sequenceTimecodeFrameRate({ num: 48, den: 1 }), 48);
	assert.throws(() => sequenceTimecodeFrameRate({ num: 0, den: 1 }), /must be positive/);
});

test('drop frame stays limited to the two rates the document validator allows', () => {
	assert.deepEqual([...SEQUENCE_DROP_FRAME_RATES], ['30000/1001', '60000/1001']);
	assert.ok(isSequenceDropFrameRate(NTSC));
	assert.ok(isSequenceDropFrameRate(NTSC_DOUBLE));
	assert.ok(!isSequenceDropFrameRate({ num: 30, den: 1 }));
	assert.deepEqual(sequenceTimecodeGeometry(NTSC, true), { nominalRate: 30, droppedLabels: 2 });
	assert.deepEqual(sequenceTimecodeGeometry(NTSC_DOUBLE, true), { nominalRate: 60, droppedLabels: 4 });
	assert.deepEqual(sequenceTimecodeGeometry(NTSC, false), { nominalRate: 30, droppedLabels: 0 });
	assert.throws(() => sequenceTimecodeGeometry({ num: 30, den: 1 }, true), /only legal at 30000\/1001/);
});

test('drop-frame labels skip minute starts except every tenth minute', () => {
	const label = (count: number) => formatSequenceTimecode(
		sequenceTimecodeFromFrameCount(count, NTSC, true),
		NTSC,
		true,
	);
	assert.equal(label(0), '00:00:00;00');
	assert.equal(label(1_799), '00:00:59;29');
	assert.equal(label(1_800), '00:01:00;02');
	assert.equal(label(17_981), '00:09:59;29');
	assert.equal(label(17_982), '00:10:00;00');
	assert.equal(label(107_892), '01:00:00;00');
	assert.equal(label(2_589_407), '23:59:59;29');
	assert.equal(label(2_589_408), '24:00:00;00');
});

test('the doubled drop-frame rate skips four labels per minute', () => {
	const label = (count: number) => formatSequenceTimecode(
		sequenceTimecodeFromFrameCount(count, NTSC_DOUBLE, true),
		NTSC_DOUBLE,
		true,
	);
	assert.equal(label(3_599), '00:00:59;59');
	assert.equal(label(3_600), '00:01:00;04');
	assert.equal(label(35_964), '00:10:00;00');
});

test('non-drop labels count every frame at every supported rate', () => {
	assert.equal(
		formatSequenceTimecode(sequenceTimecodeFromFrameCount(1_800, NTSC, false), NTSC, false),
		'00:01:00:00',
	);
	assert.equal(
		formatSequenceTimecode(sequenceTimecodeFromFrameCount(1_500, PAL, false), PAL, false),
		'00:01:00:00',
	);
	assert.equal(
		formatSequenceTimecode(sequenceTimecodeFromFrameCount(24, FILM_NTSC, false), FILM_NTSC, false),
		'00:00:01:00',
	);
	assert.equal(
		formatSequenceTimecode(sequenceTimecodeFromFrameCount(-25, PAL, false), PAL, false),
		'-00:00:01:00',
	);
});

test('labels round-trip through their frame counts at every qualified rate', () => {
	const rates = [
		[FILM_NTSC, false], [{ num: 24, den: 1 }, false], [PAL, false],
		[NTSC, true], [NTSC, false], [{ num: 30, den: 1 }, false],
		[{ num: 50, den: 1 }, false], [NTSC_DOUBLE, true], [{ num: 60, den: 1 }, false],
	] as const;
	for (const [rate, dropFrame] of rates) {
		for (const count of [0, 1, 29, 1_798, 1_800, 17_982, 107_892, 5_183_999]) {
			const timecode = sequenceTimecodeFromFrameCount(count, rate, dropFrame);
			assert.equal(
				sequenceTimecodeToFrameCount(timecode, rate, dropFrame),
				count,
				`${String(rate.num)}/${String(rate.den)} drop=${String(dropFrame)} count=${String(count)}`,
			);
			assert.deepEqual(
				parseSequenceTimecode(formatSequenceTimecode(timecode, rate, dropFrame), rate, dropFrame),
				timecode,
			);
		}
	}
});

test('every drop-frame count in the first ten minutes maps to a unique legal label', () => {
	const labels = new Set<string>();
	for (let count = 0; count < 17_982; count += 1) {
		const timecode = sequenceTimecodeFromFrameCount(count, NTSC, true);
		assert.ok(isLegalSequenceTimecode(timecode, NTSC, true), `illegal label at ${String(count)}`);
		labels.add(formatSequenceTimecode(timecode, NTSC, true));
		assert.equal(sequenceTimecodeToFrameCount(timecode, NTSC, true), count);
	}
	assert.equal(labels.size, 17_982);
});

test('labels a rate cannot produce are rejected rather than repaired', () => {
	const skipped = { negative: false, hours: 0, minutes: 1, seconds: 0, frames: 1 };
	assert.throws(() => sequenceTimecodeToFrameCount(skipped, NTSC, true), /does not label this frame/);
	assert.ok(!isLegalSequenceTimecode(skipped, NTSC, true));
	assert.ok(isLegalSequenceTimecode(skipped, NTSC, false));
	assert.throws(
		() => sequenceTimecodeToFrameCount({ negative: false, hours: 0, minutes: 0, seconds: 0, frames: 25 }, PAL, false),
		/outside its sequence rate/,
	);
	assert.throws(
		() => sequenceTimecodeToFrameCount({ negative: false, hours: 0, minutes: 60, seconds: 0, frames: 0 }, PAL, false),
		/more than 59 minutes/,
	);
	assert.throws(() => parseSequenceTimecode('00:01:00;01', NTSC, true), /does not label this frame/);
	assert.throws(() => parseSequenceTimecode('nonsense', PAL, false), /Unsupported timecode/);
});

test('parsing accepts either separator and an explicit sign', () => {
	assert.deepEqual(parseSequenceTimecode('01:00:00;00', NTSC, true), {
		negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0,
	});
	assert.deepEqual(parseSequenceTimecode('01:00:00:00', NTSC, true), {
		negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0,
	});
	assert.deepEqual(parseSequenceTimecode('-0:0:1:2', PAL, false), {
		negative: true, hours: 0, minutes: 0, seconds: 1, frames: 2,
	});
});

test('conforming moves an illegal label onto the nearest label the rate produces', () => {
	assert.deepEqual(
		conformSequenceTimecode({ negative: false, hours: 1, minutes: 0, seconds: 0, frames: 29 }, PAL, false),
		{ negative: false, hours: 1, minutes: 0, seconds: 0, frames: 24 },
	);
	assert.deepEqual(
		conformSequenceTimecode({ negative: false, hours: 0, minutes: 1, seconds: 0, frames: 0 }, NTSC, true),
		{ negative: false, hours: 0, minutes: 1, seconds: 0, frames: 2 },
	);
	assert.deepEqual(
		conformSequenceTimecode({ negative: false, hours: 0, minutes: 10, seconds: 0, frames: 0 }, NTSC, true),
		{ negative: false, hours: 0, minutes: 10, seconds: 0, frames: 0 },
	);
	const legal = { negative: true, hours: 1, minutes: 2, seconds: 3, frames: 4 };
	assert.deepEqual(conformSequenceTimecode(legal, PAL, false), legal);
});
