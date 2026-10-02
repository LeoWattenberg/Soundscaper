/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAX_SPREADSHEET_CELLS,
	MAX_SPREADSHEET_TEXT_LENGTH,
	normalizeSpreadsheetRange,
	parseSpreadsheetTsv,
	planSpreadsheetPaste,
	serializeSpreadsheetTsv,
} from '../src/common/editor/ui/clip-spreadsheet/clipboard.ts';

test('spreadsheet TSV round trips quoted tabs, line breaks, quotes, and empty cells', () => {
	const cells = [
		['Name', 'Position', 'Notes', ''],
		['voice\ttake', '2.5', 'line one\nline two', ''],
		['He said "hello"', '', 'CR\rLF\r\n', 'tail'],
	];
	const serialized = serializeSpreadsheetTsv(cells);
	assert.match(serialized, /"voice\ttake"/u);
	assert.match(serialized, /"He said ""hello"""/u);
	assert.deepEqual(parseSpreadsheetTsv(serialized), cells);
	assert.deepEqual(parseSpreadsheetTsv(`${serialized}\r\n`), cells);
});

test('TSV accepts spreadsheet row separators and preserves trailing empty fields and rows', () => {
	assert.deepEqual(parseSpreadsheetTsv('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
	assert.deepEqual(parseSpreadsheetTsv('a\tb\rc\td\r'), [['a', 'b'], ['c', 'd']]);
	assert.deepEqual(parseSpreadsheetTsv('a\t\n\t\n'), [['a', ''], ['', '']]);
	assert.deepEqual(parseSpreadsheetTsv('a\n\n'), [['a'], ['']]);
	assert.deepEqual(parseSpreadsheetTsv(''), [['']]);
	assert.deepEqual(parseSpreadsheetTsv('\n'), [['']]);
	assert.deepEqual(parseSpreadsheetTsv('""'), [['']]);
	assert.deepEqual(parseSpreadsheetTsv('"a"\t"b"'), [['a', 'b']]);
});

test('TSV rejects broken quoting and nonrectangular data without repairing it', () => {
	for (const text of ['"unterminated', '"a"tail', 'a"b', '"a" "b"', 'a\tb\nc', 'a\nb\tc']) {
		assert.throws(() => parseSpreadsheetTsv(text), Error, text);
	}
	assert.throws(() => serializeSpreadsheetTsv([]), /empty/u);
	assert.throws(() => serializeSpreadsheetTsv([[]]), /empty/u);
	assert.throws(() => serializeSpreadsheetTsv([['a'], ['b', 'c']]), /rectangular/u);
});

test('TSV parsing and serialization bound clipboard size and cell counts', () => {
	assert.throws(() => parseSpreadsheetTsv('a'.repeat(MAX_SPREADSHEET_TEXT_LENGTH + 1)), /large/u);
	assert.throws(() => parseSpreadsheetTsv('\t'.repeat(MAX_SPREADSHEET_CELLS)), /large/u);
	assert.throws(() => serializeSpreadsheetTsv([Array<string>(MAX_SPREADSHEET_CELLS + 1).fill('')]), /large/u);
	assert.throws(() => serializeSpreadsheetTsv([['a'.repeat(MAX_SPREADSHEET_TEXT_LENGTH + 1)]]), /large/u);
});

test('rectangular selections normalize either drag direction with inclusive zero-based bounds', () => {
	assert.deepEqual(normalizeSpreadsheetRange({ row: 4, column: 1 }, { row: 2, column: 5 }), {
		top: 2, left: 1, bottom: 4, right: 5,
	});
	assert.deepEqual(normalizeSpreadsheetRange({ row: 2, column: 5 }, { row: 4, column: 1 }), {
		top: 2, left: 1, bottom: 4, right: 5,
	});
	for (const invalid of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
		assert.throws(() => normalizeSpreadsheetRange({ row: invalid, column: 0 }, { row: 0, column: 0 }));
		assert.throws(() => normalizeSpreadsheetRange({ row: 0, column: 0 }, { row: 0, column: invalid }));
	}
});

test('pasting a rectangle at a single cell expands from that anchor', () => {
	assert.deepEqual(planSpreadsheetPaste([['a', 'b'], ['c', 'd']], {
		top: 1, left: 2, bottom: 1, right: 2,
	}, 4, 5), [
		{ row: 1, column: 2, value: 'a' }, { row: 1, column: 3, value: 'b' },
		{ row: 2, column: 2, value: 'c' }, { row: 2, column: 3, value: 'd' },
	]);
});

test('pasting tiles an exact multiple selection including scalar fill', () => {
	assert.deepEqual(planSpreadsheetPaste([['a', 'b']], {
		top: 1, left: 0, bottom: 2, right: 3,
	}, 3, 4), [
		{ row: 1, column: 0, value: 'a' }, { row: 1, column: 1, value: 'b' },
		{ row: 1, column: 2, value: 'a' }, { row: 1, column: 3, value: 'b' },
		{ row: 2, column: 0, value: 'a' }, { row: 2, column: 1, value: 'b' },
		{ row: 2, column: 2, value: 'a' }, { row: 2, column: 3, value: 'b' },
	]);
	assert.deepEqual(planSpreadsheetPaste([['']], { top: 0, left: 0, bottom: 1, right: 0 }, 2, 1), [
		{ row: 0, column: 0, value: '' }, { row: 1, column: 0, value: '' },
	]);
	assert.deepEqual(planSpreadsheetPaste([['a'], ['b']], { top: 0, left: 0, bottom: 3, right: 0 }, 4, 1)
		.map(({ value }) => value), ['a', 'b', 'a', 'b']);
});

test('paste rejects overflow, incompatible dimensions, invalid ranges and excessive fills', () => {
	const anchor = { top: 1, left: 1, bottom: 1, right: 1 };
	assert.throws(() => planSpreadsheetPaste([['a', 'b']], anchor, 2, 2), /outside/u);
	assert.throws(() => planSpreadsheetPaste([['a'], ['b']], anchor, 2, 2), /outside/u);
	assert.throws(() => planSpreadsheetPaste([['a', 'b']], { top: 0, left: 0, bottom: 0, right: 2 }, 1, 3), /dimensions/u);
	assert.throws(() => planSpreadsheetPaste([['a', 'b']], { top: 0, left: 0, bottom: 2, right: 0 }, 3, 3), /dimensions/u);
	assert.throws(() => planSpreadsheetPaste([['a'], ['b']], { top: 0, left: 0, bottom: 2, right: 0 }, 3, 1), /dimensions/u);
	assert.throws(() => planSpreadsheetPaste([['a']], { top: 1, left: 0, bottom: 0, right: 0 }, 2, 1), /range/u);
	assert.throws(() => planSpreadsheetPaste([['a']], { top: -1, left: 0, bottom: 0, right: 0 }, 2, 1), /range/u);
	assert.throws(() => planSpreadsheetPaste([['a']], anchor, Number.NaN, 2), /dimensions/u);
	assert.throws(() => planSpreadsheetPaste([['a']], anchor, 0, 0), /outside/u);
	assert.throws(() => planSpreadsheetPaste([], anchor, 2, 2), /empty/u);
	assert.throws(() => planSpreadsheetPaste([['a']], {
		top: 0, left: 0, bottom: MAX_SPREADSHEET_CELLS, right: 0,
	}, MAX_SPREADSHEET_CELLS + 1, 1), /large/u);
});
