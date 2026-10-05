/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeEmbeddedExportChapters,
	resolveEmbeddedExportChapters,
	serializeEmbeddedExportChapters,
	supportsEmbeddedExportChapters,
} from '../src/common/editor/export-embedded-chapters.ts';

const SAMPLE_RATE = 48_000;
const RANGE = Object.freeze({ startFrame: 0, endFrame: 10 * SAMPLE_RATE });

function project(labels: readonly Record<string, unknown>[], sampleRate = SAMPLE_RATE) {
	return {
		sampleRate,
		tracks: [{ type: 'label', labels }],
	};
}

test('embedded chapters read every label track and preserve exact label titles', () => {
	const value = {
		sampleRate: SAMPLE_RATE,
		tracks: [
			{ type: 'label', labels: [] },
			{ type: 'audio', labels: [{ startFrame: 0, title: 'Ignore' }] },
			{ type: 'label', labels: [{ startFrame: 2 * SAMPLE_RATE, title: '  Résumé / 日本語  ' }] },
			{ type: 'label', labels: [{ startFrame: 0, title: '' }, { startFrame: SAMPLE_RATE, title: '' }] },
		],
		timelineAnnotations: [{ kind: 'marker', positionFrame: 0, name: 'Ignore marker' }],
	};
	const chapters = resolveEmbeddedExportChapters(value, RANGE);
	assert.deepEqual(chapters, [
		{ title: '', startFrame: 0, endFrame: SAMPLE_RATE },
		{ title: '', startFrame: SAMPLE_RATE, endFrame: 2 * SAMPLE_RATE },
		{ title: '  Résumé / 日本語  ', startFrame: 2 * SAMPLE_RATE, endFrame: RANGE.endFrame },
	]);
	assert.ok(Object.isFrozen(chapters));
	assert.ok(chapters.every((chapter) => Object.isFrozen(chapter)));
});

test('region chapters keep their own ends and points extend to the next distinct start', () => {
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: 0, endFrame: 4 * SAMPLE_RATE, title: 'Region' },
		{ startFrame: SAMPLE_RATE, title: 'Point inside region' },
		{ startFrame: 6 * SAMPLE_RATE, title: 'Last point' },
	]), RANGE), [
		{ title: 'Region', startFrame: 0, endFrame: 4 * SAMPLE_RATE },
		{ title: 'Point inside region', startFrame: SAMPLE_RATE, endFrame: 6 * SAMPLE_RATE },
		{ title: 'Last point', startFrame: 6 * SAMPLE_RATE, endFrame: RANGE.endFrame },
	]);
});

test('coincident starts retain track and label order without zero-length chapters', () => {
	const value = {
		sampleRate: SAMPLE_RATE,
		tracks: [
			{ type: 'label', labels: [{ startFrame: 0, title: 'First' }, { startFrame: 0, title: 'Second' }] },
			{ type: 'label', labels: [{ startFrame: 0, endFrame: SAMPLE_RATE, title: 'Region' }] },
		],
	};
	assert.deepEqual(resolveEmbeddedExportChapters(value, RANGE), [
		{ title: 'First', startFrame: 0, endFrame: RANGE.endFrame },
		{ title: 'Second', startFrame: 0, endFrame: RANGE.endFrame },
		{ title: 'Region', startFrame: 0, endFrame: SAMPLE_RATE },
	]);
});

test('selection chapters clip and rebase to the delivered audio', () => {
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: 0, endFrame: SAMPLE_RATE, title: 'Outside before' },
		{ startFrame: SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE, title: 'Straddling region' },
		{ startFrame: 3 * SAMPLE_RATE, title: 'Point' },
		{ startFrame: 5 * SAMPLE_RATE, title: 'At export end' },
	]), { startFrame: 2 * SAMPLE_RATE, endFrame: 5 * SAMPLE_RATE }), [
		{ title: 'Straddling region', startFrame: 0, endFrame: SAMPLE_RATE },
		{ title: 'Point', startFrame: SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE },
	]);
});

test('point chapters that overlap a selection are included at its start', () => {
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: 0, title: 'Opening' },
		{ startFrame: 3 * SAMPLE_RATE, title: 'Next' },
	]), { startFrame: SAMPLE_RATE, endFrame: 2 * SAMPLE_RATE }), [
		{ title: 'Opening', startFrame: 0, endFrame: SAMPLE_RATE },
	]);
});

test('embedded chapter timing uses rounded output frames after rebasing the project range', () => {
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: 110_250, endFrame: 110_251, title: 'One sample' },
		{ startFrame: 132_300, title: 'Last' },
	], 44_100), { startFrame: 88_200, endFrame: 176_400 }, SAMPLE_RATE), [
		{ title: 'One sample', startFrame: 24_000, endFrame: 24_001 },
		{ title: 'Last', startFrame: 48_000, endFrame: 96_000 },
	]);
});

test('regions shorter than one output frame are omitted after sample-rate conversion', () => {
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: 0, endFrame: 1, title: 'Too short' },
		{ startFrame: 100, title: 'Audible' },
	], 48_000), { startFrame: 0, endFrame: 200 }, 8_000), [
		{ title: 'Audible', startFrame: 17, endFrame: 33 },
	]);
});

test('chapter conversion stays exact when its intermediate multiplication exceeds safe integers', () => {
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: 8_000_000_000_000_017, title: 'Late chapter' },
	], 96_000), { startFrame: 0, endFrame: 8_000_000_000_000_020 }, SAMPLE_RATE), [
		{ title: 'Late chapter', startFrame: 4_000_000_000_000_009, endFrame: 4_000_000_000_000_010 },
	]);
	assert.throws(() => resolveEmbeddedExportChapters(project([
		{ startFrame: 0, title: 'Overflow' },
	], 1), { startFrame: 0, endFrame: Number.MAX_SAFE_INTEGER }, SAMPLE_RATE), /safe integer/u);
});

test('actual delivery frame counts retain labels at the resampled range edge', () => {
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: 0, endFrame: 1, title: 'One project sample' },
	], 48_000), { startFrame: 0, endFrame: 1 }, 8_000, { rangeOutputFrames: 1 }), [
		{ title: 'One project sample', startFrame: 0, endFrame: 1 },
	]);
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: 99, endFrame: 100, title: 'At edge' },
	], 48_000), { startFrame: 0, endFrame: 100 }, 8_000, { rangeOutputFrames: 17 }), [
		{ title: 'At edge', startFrame: 16, endFrame: 17 },
	]);
});

test('the final ongoing point includes the delivery tail while region ends retain the nominal range', () => {
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: 0, endFrame: 100, title: 'Whole region' },
		{ startFrame: 50, title: 'Ongoing point' },
		{ startFrame: 100, title: 'Outside delivered range' },
	], 48_000), { startFrame: 0, endFrame: 100 }, 8_000, {
		rangeOutputFrames: 17, deliveryOutputFrames: 27,
	}), [
		{ title: 'Whole region', startFrame: 0, endFrame: 17 },
		{ title: 'Ongoing point', startFrame: 8, endFrame: 27 },
	]);
});

test('declared delivery frame counts must fit the nominal range and safe integer bounds', () => {
	for (const counts of [
		{ rangeOutputFrames: 0 },
		{ rangeOutputFrames: 16 },
		{ rangeOutputFrames: 17.5 },
		{ rangeOutputFrames: 17, deliveryOutputFrames: 16 },
		{ deliveryOutputFrames: 0 },
		{ deliveryOutputFrames: Number.MAX_SAFE_INTEGER + 1 },
	]) assert.throws(() => resolveEmbeddedExportChapters(project([], 48_000), {
		startFrame: 0, endFrame: 100,
	}, 8_000, counts), RangeError);
});

test('projects without applicable labels resolve no embedded chapters', () => {
	assert.deepEqual(resolveEmbeddedExportChapters(project([]), RANGE), []);
	assert.deepEqual(resolveEmbeddedExportChapters({ sampleRate: SAMPLE_RATE }, RANGE), []);
	assert.deepEqual(resolveEmbeddedExportChapters(project([
		{ startFrame: RANGE.endFrame, title: 'After' },
	]), RANGE), []);
});

test('embedded chapter resolution refuses invalid ranges, frame positions and sample rates', () => {
	for (const range of [
		{ startFrame: -1, endFrame: 100 },
		{ startFrame: 0.5, endFrame: 100 },
		{ startFrame: 100, endFrame: 100 },
		{ startFrame: 101, endFrame: 100 },
		{ startFrame: 0, endFrame: Number.MAX_SAFE_INTEGER + 1 },
	]) assert.throws(() => resolveEmbeddedExportChapters(project([]), range), RangeError);
	for (const labels of [
		[{ startFrame: -1, title: 'Invalid' }],
		[{ startFrame: 0.5, title: 'Invalid' }],
		[{ startFrame: 2, endFrame: 1, title: 'Invalid' }],
		[{ startFrame: 0, endFrame: NaN, title: 'Invalid' }],
	]) assert.throws(() => resolveEmbeddedExportChapters(project(labels), RANGE), RangeError);
	for (const sampleRate of [0, -1, NaN, Infinity, 48_000.5, 2_147_483_648]) {
		assert.throws(() => resolveEmbeddedExportChapters(project([]), RANGE, sampleRate), RangeError);
		assert.throws(() => normalizeEmbeddedExportChapters([], sampleRate), RangeError);
	}
	assert.throws(() => resolveEmbeddedExportChapters({}, RANGE), /sample rate/iu);
});

test('only MP3 and AAC in M4A support this embedded chapter delivery', () => {
	for (const format of ['mp3', 'aac-m4a']) assert.equal(supportsEmbeddedExportChapters(format), true);
	for (const format of ['wav', 'flac', 'opus', 'aac', 'mp4', undefined, null]) {
		assert.equal(supportsEmbeddedExportChapters(format), false);
	}
});

test('chapter normalization clones and freezes ordered chapter records', () => {
	const source = [
		{ startFrame: 0, endFrame: 100, title: 'Same', ignored: true },
		{ startFrame: 0, endFrame: 200, title: 'Same' },
	];
	const normalized = normalizeEmbeddedExportChapters(source, SAMPLE_RATE);
	assert.deepEqual(normalized, [
		{ startFrame: 0, endFrame: 100, title: 'Same' },
		{ startFrame: 0, endFrame: 200, title: 'Same' },
	]);
	assert.notEqual(normalized, source);
	source[0].title = 'Changed';
	assert.equal(normalized[0].title, 'Same');
	assert.ok(Object.isFrozen(normalized));
	assert.ok(normalized.every((chapter) => Object.isFrozen(chapter)));
	assert.deepEqual(normalizeEmbeddedExportChapters([], SAMPLE_RATE), []);
});

test('chapter normalization requires plain objects with own frame and title values', () => {
	const invalid: readonly unknown[] = [
		null,
		{},
		[null],
		new Array<unknown>(1),
		[[0, 1, 'Title']],
		[new Date()],
		[Object.create({ startFrame: 0, endFrame: 100, title: 'Inherited' }) as unknown],
		[{ startFrame: 0, endFrame: 100 }],
		[{ startFrame: 0, endFrame: 100, title: 1 }],
		[{ startFrame: '0', endFrame: 100, title: 'Title' }],
		[{ startFrame: 0, endFrame: Infinity, title: 'Title' }],
		[{ startFrame: -1, endFrame: 100, title: 'Title' }],
		[{ startFrame: 1, endFrame: 1, title: 'Title' }],
		[{ startFrame: 0, endFrame: Number.MAX_SAFE_INTEGER + 1, title: 'Title' }],
		[{ startFrame: 10, endFrame: 100, title: 'Later' }, { startFrame: 0, endFrame: 20, title: 'Earlier' }],
	];
	for (const value of invalid) assert.throws(() => normalizeEmbeddedExportChapters(value, SAMPLE_RATE), RangeError);
	let read = false;
	const accessor = { startFrame: 0, endFrame: 100, get title() { read = true; return 'Getter'; } };
	assert.throws(() => normalizeEmbeddedExportChapters([accessor], SAMPLE_RATE), RangeError);
	assert.equal(read, false);
});

test('chapter normalization bounds titles and counts and refuses NUL characters', () => {
	const chapter = { startFrame: 0, endFrame: 100, title: 'Valid' };
	assert.throws(() => normalizeEmbeddedExportChapters([{ ...chapter, title: 'With\0NUL' }], SAMPLE_RATE), /NUL/u);
	assert.throws(() => normalizeEmbeddedExportChapters([{ ...chapter, title: 'x'.repeat(1_000_001) }], SAMPLE_RATE), /title.*limit/iu);
	assert.throws(() => normalizeEmbeddedExportChapters(Array.from({ length: 9 }, () => ({
		...chapter, title: 'x'.repeat(1_000_000),
	})), SAMPLE_RATE), /total.*title.*limit/iu);
	assert.throws(() => normalizeEmbeddedExportChapters(Array.from({ length: 100_001 }, () => chapter), SAMPLE_RATE), /chapter.*limit/iu);
});

test('FFmetadata writes output frame timebases, exact Unicode titles and escaped syntax', () => {
	const title = '  日本語 \\ =;#\nSecond\r\nThird  ';
	assert.equal(serializeEmbeddedExportChapters([
		{ startFrame: 0, endFrame: 48_000, title },
		{ startFrame: 48_000, endFrame: 96_000, title: 'Résumé' },
	], SAMPLE_RATE), [
		';FFMETADATA1',
		'[CHAPTER]',
		'TIMEBASE=1/48000',
		'START=0',
		'END=48000',
		'title=  日本語 \\\\ \\=\\;\\#\\\nSecond\\\r\\\nThird  ',
		'[CHAPTER]',
		'TIMEBASE=1/48000',
		'START=48000',
		'END=96000',
		'title=Résumé',
		'',
	].join('\n'));
	assert.equal(serializeEmbeddedExportChapters([], SAMPLE_RATE), ';FFMETADATA1\n');
});

test('FFmetadata serialization also validates chapter data and its timebase', () => {
	assert.throws(() => serializeEmbeddedExportChapters([
		{ startFrame: 0, endFrame: 0, title: 'Invalid' },
	], SAMPLE_RATE), RangeError);
	assert.throws(() => serializeEmbeddedExportChapters([], 0), RangeError);
});

test('FFmetadata can omit titles for encoders that supply literal chapter tags separately', () => {
	assert.equal(serializeEmbeddedExportChapters([
		{ startFrame: 0, endFrame: 48_000, title: 'Trailing backslash \\' },
		{ startFrame: 48_000, endFrame: 96_000, title: 'Second chapter' },
	], SAMPLE_RATE, { includeTitles: false }), [
		';FFMETADATA1',
		'[CHAPTER]',
		'TIMEBASE=1/48000',
		'START=0',
		'END=48000',
		'[CHAPTER]',
		'TIMEBASE=1/48000',
		'START=48000',
		'END=96000',
		'',
	].join('\n'));
});
