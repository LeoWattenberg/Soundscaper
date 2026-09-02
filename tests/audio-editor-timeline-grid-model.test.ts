/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { CLIP_CONTENT_OFFSET } from '../vendor/audacity-design-system/components/src/constants.ts';
import { createSequenceRulerTicks } from '../src/common/editor/ui/timeline/sequence-ruler-model.ts';
import {
	createTimelineGridLines,
	resolveTimelineRulerScale,
	timelineMajorInterval,
	type TimelineRulerScale,
} from '../src/common/editor/ui/timeline/timeline-grid-model.ts';

const VENDORED_RULER = new URL(
	'../vendor/audacity-design-system/components/src/TimelineRuler/TimelineRuler.tsx',
	import.meta.url,
);
const SAMPLE_RATE = 48_000;
const MINUTES_SECONDS: TimelineRulerScale = Object.freeze({ kind: 'minutes-seconds' as const });

const TEMPO_MAP = {
	mode: 'musical' as const,
	events: [
		{ id: 'tempo-0', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
		{ id: 'tempo-1', beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
	],
};
const SIGNATURE_MAP = {
	events: [
		{ id: 'signature-0', bar: 0, numerator: 4, denominator: 4 },
		{ id: 'signature-1', bar: 1, numerator: 3, denominator: 4 },
	],
};
const SEQUENCE_PROJECT = {
	sampleRate: SAMPLE_RATE,
	primarySequenceId: 'main',
	timeDisplay: { format: 'timecode' },
	sequences: [{
		id: 'main',
		name: 'Main sequence',
		rate: { num: 25, den: 1 },
		dropFrame: false,
		startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
	}],
};

function lines(scale: TimelineRulerScale, pixelsPerSecond: number, scrollX = 0, viewportWidth = 600) {
	return createTimelineGridLines({ scale, pixelsPerSecond, scrollX, viewportWidth, sampleRate: SAMPLE_RATE })
		.map(({ x, major }) => [x, major] as const);
}

/** The columns a ruler canvas draws for its ticks: the same projection, floor and clip. */
function rulerColumns(
	ticks: readonly Readonly<{ frame: number; major: boolean }>[],
	pixelsPerSecond: number,
	scrollX: number,
	viewportWidth = 600,
): (readonly [number, boolean])[] {
	return ticks.flatMap((tick) => {
		const x = CLIP_CONTENT_OFFSET + tick.frame / SAMPLE_RATE * pixelsPerSecond - scrollX;
		return x < CLIP_CONTENT_OFFSET || x > viewportWidth ? [] : [[Math.floor(x), tick.major] as const];
	});
}

function assertWithinOnePixel(
	actual: readonly (readonly [number, boolean])[],
	ideal: readonly (readonly [number, boolean])[],
): void {
	assert.equal(actual.length, ideal.length);
	for (const [index, [x, major]] of actual.entries()) {
		assert.ok(Math.abs(x - ideal[index]![0]) <= 1, `column ${index}: ${x} vs ${ideal[index]![0]}`);
		assert.equal(major, ideal[index]![1], `column ${index} major`);
	}
}

function expectedColumns(
	pixelsPerStep: number,
	majorEvery: number,
	scrollX = 0,
	viewportWidth = 600,
): (readonly [number, boolean])[] {
	const expected: (readonly [number, boolean])[] = [];
	for (let step = 0; ; step += 1) {
		const x = CLIP_CONTENT_OFFSET + step * pixelsPerStep - scrollX;
		if (x > viewportWidth) break;
		if (x < CLIP_CONTENT_OFFSET) continue;
		expected.push([Math.floor(x), step % majorEvery === 0]);
	}
	return expected;
}

test('the ruler scale resolves the way the timeline picks its ruler canvas', () => {
	assert.deepEqual(resolveTimelineRulerScale({}), { kind: 'minutes-seconds' });
	assert.deepEqual(resolveTimelineRulerScale({ timeDisplay: { format: 'hh:mm:ss+milliseconds' } }), {
		kind: 'minutes-seconds',
	});
	assert.deepEqual(resolveTimelineRulerScale({ timeDisplay: { format: 'beats+measures' } }), {
		kind: 'beats-measures', bpm: 120, beatsPerMeasure: 4,
	});
	assert.deepEqual(resolveTimelineRulerScale({
		timeDisplay: { format: 'beats+measures' },
		tempo: { bpm: 90, timeSignature: { numerator: 7, denominator: 4 } },
	}), { kind: 'beats-measures', bpm: 90, beatsPerMeasure: 7 });
	assert.deepEqual(resolveTimelineRulerScale({
		timeDisplay: { format: 'beats+measures' },
		tempo: { bpm: 90, timeSignature: { numerator: 7, denominator: 4 } },
		tempoMap: { mode: 'musical', events: [{ id: 'tempo-0', beat: { num: 0, den: 1 }, bpm: { num: 100, den: 3 } }] },
		signatureMap: { events: [{ id: 'signature-0', bar: 0, numerator: 3, denominator: 4 }] },
	}), { kind: 'beats-measures', bpm: 100 / 3, beatsPerMeasure: 3 });
	const musical = resolveTimelineRulerScale({
		timeDisplay: { format: 'beats+measures' },
		tempoMap: TEMPO_MAP,
		signatureMap: SIGNATURE_MAP,
	});
	assert.equal(musical.kind, 'musical-map');
	assert.ok(musical.kind === 'musical-map' && musical.tempoMap === TEMPO_MAP && musical.signatureMap === SIGNATURE_MAP);
	const timecode = resolveTimelineRulerScale({ ...SEQUENCE_PROJECT, tempoMap: TEMPO_MAP, signatureMap: SIGNATURE_MAP });
	assert.equal(timecode.kind, 'timecode');
	assert.ok(timecode.kind === 'timecode' && timecode.view.id === 'main' && timecode.view.nominalFrameRate === 25);
	assert.deepEqual(resolveTimelineRulerScale({ ...SEQUENCE_PROJECT, sequences: [] }), { kind: 'minutes-seconds' });
});

test('the zoom table and tick rounding mirror the vendored ruler source', () => {
	const source = readFileSync(VENDORED_RULER, 'utf8');
	const body = source.slice(source.indexOf('function getTimelineMajorInterval'));
	const rows = [...body.matchAll(/if \(pixelsPerSecond < (\d+)\) return ([\d.]+);/gu)]
		.map((match) => [Number(match[1]), Number(match[2])] as const);
	const fallback = /\n {2}return ([\d.]+);\n\}/u.exec(body);
	assert.ok(rows.length >= 5 && fallback, 'the vendored zoom table must still be readable');
	let lowerBound = 0;
	for (const [threshold, interval] of rows) {
		assert.equal(timelineMajorInterval(lowerBound), interval, `zoom ${lowerBound}`);
		assert.equal(timelineMajorInterval(threshold - 0.001), interval, `zoom just under ${threshold}`);
		lowerBound = threshold;
	}
	assert.equal(timelineMajorInterval(lowerBound), Number(fallback[1]));
	assert.equal(timelineMajorInterval(lowerBound * 10), Number(fallback[1]));
	assert.match(source, /const minorInterval = majorInterval \/ 5;/u);
	assert.match(source, /if \(x < CLIP_CONTENT_OFFSET \|\| x > width\) continue;/u);
	assert.match(source, /const tickX = Math\.floor\(x\) \+ 0\.5;/u);
	assert.match(source, /if \(pixelsPerBeat >= 160\) subdivisionsPerBeat = 8;/u);
	assert.match(source, /const showBeatTicks = pixelsPerBeat >= 8;/u);
	assert.match(source, /if \(pixelsPerMeasure \* interval >= 60\)/u);
	assert.match(source, /const showMinorMeasureTicks = pixelsPerMeasure >= 6;/u);
});

test('minutes-and-seconds lines sit on every ruler tick with labelled ticks as major lines', () => {
	// 120 px/s labels every second and marks fifths of a second between labels.
	assert.deepEqual(lines(MINUTES_SECONDS, 120), expectedColumns(24, 5));
	// 30 px/s labels every five seconds and marks every second.
	assert.deepEqual(lines(MINUTES_SECONDS, 30), expectedColumns(30, 5));
	// 2_400 px/s labels every twentieth of a second. Hundredths of a second are
	// not exact in binary, so the vendored ruler floors some of these ticks one
	// pixel early; the grid must land on the ruler's column, not the ideal one.
	// Every labelled tick is still a major line, including 0.15 s, which the
	// ruler's bottom-half modulo check misclassifies.
	assertWithinOnePixel(lines(MINUTES_SECONDS, 2_400), expectedColumns(24, 5));
});

test('a scrolled or fractionally zoomed viewport keeps whole-pixel columns on the tick grid', () => {
	assert.deepEqual(lines(MINUTES_SECONDS, 120, 250), expectedColumns(24, 5, 250));
	assert.deepEqual(lines(MINUTES_SECONDS, 120, 7_777, 1_000), expectedColumns(24, 5, 7_777, 1_000));
	const fractional = lines(MINUTES_SECONDS, 133.7);
	assert.deepEqual(
		fractional.map(([x]) => x),
		Array.from({ length: 22 }, (_, step) => Math.floor(CLIP_CONTENT_OFFSET + step * 0.2 * 133.7)),
	);
	assert.ok(fractional.every(([x]) => Number.isInteger(x)));
	assert.ok(fractional.every(([x], index) => index === 0 || x > fractional[index - 1]![0]));
	assert.deepEqual(fractional.filter(([, major]) => major).map(([x]) => x), [12, 145, 279, 413, 546]);
});

test('beats-and-measures lines follow labelled measures, beats and their subdivisions', () => {
	const scale: TimelineRulerScale = { kind: 'beats-measures', bpm: 120, beatsPerMeasure: 4 };
	// 120 px/s puts a beat every 60 px and marks eighth notes every 30 px.
	assert.deepEqual(lines(scale, 120), expectedColumns(30, 8));
	// 10 px/s hides beats and labels every fourth measure, marking the others.
	assert.deepEqual(lines(scale, 10), expectedColumns(20, 4));
	// A scrolled 3/4 ruler stays on its measure grid. The vendored ruler sums
	// floating seconds per measure, so a column may land one pixel early; the
	// grid follows the ruler rather than the ideal position.
	// 200 px/s puts a beat every 120 px and marks sixteenth notes every 30 px.
	assertWithinOnePixel(
		lines({ kind: 'beats-measures', bpm: 100, beatsPerMeasure: 3 }, 200, 500),
		expectedColumns(30, 12, 500),
	);
});

test('timecode and musical-map scales project their ruler ticks to columns', () => {
	const timecode = resolveTimelineRulerScale(SEQUENCE_PROJECT);
	// 25 fps at 200 px/s: labels every ten frames, ticks on every frame (8 px).
	for (const scrollX of [0, 1_000]) {
		const actual = lines(timecode, 200, scrollX);
		assert.deepEqual(actual, rulerColumns(createSequenceRulerTicks({
			view: (timecode as Extract<TimelineRulerScale, { kind: 'timecode' }>).view,
			sampleRate: SAMPLE_RATE,
			startFrame: Math.floor(scrollX / 200 * SAMPLE_RATE),
			endFrame: Math.ceil((scrollX + 600) / 200 * SAMPLE_RATE),
			pixelsPerSample: 200 / SAMPLE_RATE,
		}), 200, scrollX));
		assert.equal(actual.length, 74);
		assert.deepEqual(actual.map(([, major]) => major), actual.map((_, index) => index % 10 === (scrollX ? 5 : 0)));
		assert.ok(actual.every(([x], index) => index === 0 || x - actual[index - 1]![0] >= 7));
	}
	const musical: TimelineRulerScale = { kind: 'musical-map', tempoMap: TEMPO_MAP, signatureMap: SIGNATURE_MAP };
	assert.deepEqual(lines(musical, 120), [
		[12, true], [72, false], [132, false], [192, false],
		[252, true], [372, false], [492, false],
	]);
	assert.deepEqual(lines(musical, 120, 100), [
		[32, false], [92, false], [152, true], [272, false], [392, false], [512, true],
	]);
});

test('grid line inputs are validated', () => {
	const options = { scale: MINUTES_SECONDS, pixelsPerSecond: 120, scrollX: 0, viewportWidth: 600, sampleRate: SAMPLE_RATE };
	assert.throws(() => createTimelineGridLines({ ...options, pixelsPerSecond: 0 }), RangeError);
	assert.throws(() => createTimelineGridLines({ ...options, scrollX: -1 }), RangeError);
	assert.throws(() => createTimelineGridLines({ ...options, viewportWidth: Number.NaN }), RangeError);
	assert.throws(() => createTimelineGridLines({ ...options, sampleRate: 0 }), RangeError);
	assert.throws(() => createTimelineGridLines({
		...options,
		scale: { kind: 'beats-measures', bpm: 0, beatsPerMeasure: 4 },
	}), RangeError);
	assert.throws(() => createTimelineGridLines({
		...options,
		scale: { kind: 'beats-measures', bpm: 120, beatsPerMeasure: 0 },
	}), RangeError);
});
