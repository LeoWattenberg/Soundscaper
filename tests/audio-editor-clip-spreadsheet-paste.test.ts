/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CLIP_SPREADSHEET_COLUMNS, type ClipSpreadsheetRow } from '../src/common/editor/clip-spreadsheet.ts';
import { matchClipSpreadsheetSourceFiles, planClipSpreadsheetPaste } from '../src/common/editor/ui/clip-spreadsheet/paste.ts';

const origin = { top: 0, left: 0, bottom: 0, right: 0 };
function row(id: string): ClipSpreadsheetRow {
	return { id, kind: 'audio', editable: true, cells: Object.fromEntries(CLIP_SPREADSHEET_COLUMNS.map(column => [column.id, ''])) as ClipSpreadsheetRow['cells'] };
}
const fullRow = (name: string, source = 'Voice.wav') => [name, 'Voice', '2', source, '0', '1', '0', '1', '0', '0', '0', 'false', 'false', '48000', '1'].join('\t');

test('paste edits existing clips and creates overflow rows in one plan', () => {
	const rows = [row('first')];
	const result = planClipSpreadsheetPaste(`${fullRow('Updated')}\r\n${fullRow('New')}`, origin, rows);
	assert.equal(result.edits.length, CLIP_SPREADSHEET_COLUMNS.length);
	assert.deepEqual(result.edits[0], { clipId: 'first', column: 'name', value: 'Updated' });
	assert.equal(result.newRows.length, 1);
	assert.equal(result.newRows[0]?.name, 'New');
	assert.equal(result.newRows[0]?.source, 'Voice.wav');
	assert.deepEqual(result.range, { top: 0, left: 0, bottom: 1, right: CLIP_SPREADSHEET_COLUMNS.length - 1 });
	assert.equal(rows[0]?.cells.name, '');
});

test('empty-grid and explicit append anchors create rows without overwriting existing clips', () => {
	const empty = planClipSpreadsheetPaste(fullRow('First'), origin, []);
	assert.deepEqual(empty.edits, []);
	assert.equal(empty.newRows[0]?.name, 'First');
	const appended = planClipSpreadsheetPaste(`${fullRow('Second')}\n${fullRow('Third')}`, {
		top: 1, left: 0, bottom: 1, right: 0,
	}, [row('first')]);
	assert.deepEqual(appended.edits, []);
	assert.deepEqual(appended.newRows.map(value => value.name), ['Second', 'Third']);
	assert.equal(appended.range.bottom, 2);
});

test('a selected whole row expands when pasting several rows', () => {
	const result = planClipSpreadsheetPaste(`${fullRow('First')}\n${fullRow('Second')}`, {
		...origin, right: CLIP_SPREADSHEET_COLUMNS.length - 1,
	}, [row('first')]);
	assert.equal(result.edits[0]?.clipId, 'first');
	assert.equal(result.newRows[0]?.name, 'Second');
	assert.equal(result.range.bottom, 1);
});

test('ordinary selections retain scalar fill and rectangular tiling', () => {
	const rows = [row('first'), row('second')];
	const filled = planClipSpreadsheetPaste('2', { top: 0, left: 6, bottom: 1, right: 7 }, rows);
	assert.deepEqual(filled.edits, [
		{ clipId: 'first', column: 'pitch', value: '2' }, { clipId: 'first', column: 'speed', value: '2' },
		{ clipId: 'second', column: 'pitch', value: '2' }, { clipId: 'second', column: 'speed', value: '2' },
	]);
	assert.deepEqual(filled.newRows, []);
	const tiled = planClipSpreadsheetPaste('1\t2', { top: 0, left: 6, bottom: 1, right: 7 }, rows);
	assert.deepEqual(tiled.edits.map(edit => edit.value), ['1', '2', '1', '2']);
});

test('partial new rows preserve supplied columns for domain validation', () => {
	const result = planClipSpreadsheetPaste('Voice.wav\t0.5', { top: 0, left: 3, bottom: 0, right: 3 }, []);
	assert.deepEqual(result.newRows, [{ source: 'Voice.wav', offset: '0.5' }]);
	assert.deepEqual(planClipSpreadsheetPaste('Name only', origin, []).newRows, [{ name: 'Name only' }]);
});

test('paste rejects invalid ranges, skipped rows, ragged matrices, column overflow and incompatible dimensions', () => {
	assert.throws(() => planClipSpreadsheetPaste('a\tb\nc', origin, []), /rectangular/u);
	assert.throws(() => planClipSpreadsheetPaste('a', { top: 2, left: 0, bottom: 2, right: 0 }, [row('first')]), /range/u);
	assert.throws(() => planClipSpreadsheetPaste('a', { top: 0, left: 0, bottom: 2, right: 0 }, [row('first')]), /range/u);
	assert.throws(() => planClipSpreadsheetPaste('a\tb', { top: 0, left: 14, bottom: 0, right: 14 }, []), /outside/u);
	assert.throws(() => planClipSpreadsheetPaste('1\t2', { top: 0, left: 0, bottom: 0, right: 2 }, [row('first')]), /dimensions/u);
	assert.throws(() => planClipSpreadsheetPaste('a', { ...origin, left: Number.NaN }, []), /range/u);
});

test('source matching accepts exact POSIX, Windows, file URL and chooser-relative paths', () => {
	const posix = { name: 'Voice.wav', path: '/home/music/Voice.wav' };
	const windows = { name: 'Piano.WAV', path: 'C:\\Music\\Piano.WAV' };
	const relative = { name: 'Room tone.wav', webkitRelativePath: 'session/audio/Room tone.wav' };
	const refs = ['file:///home/music/Voice.wav', 'file:///C:/Music/Piano.WAV', './session/audio/Room tone.wav'];
	const matched = matchClipSpreadsheetSourceFiles(refs, [posix, windows, relative]);
	assert.equal(matched.get(refs[0]!), posix);
	assert.equal(matched.get(refs[1]!), windows);
	assert.equal(matched.get(refs[2]!), relative);
	const encoded = matchClipSpreadsheetSourceFiles(['file:///tmp/Room%20tone.wav'], [relative]);
	assert.equal(encoded.get('file:///tmp/Room%20tone.wav'), relative);
});

test('source matching falls back to a unique basename and reuses repeated equivalent references', () => {
	const file = { name: 'Voice.wav' };
	const matched = matchClipSpreadsheetSourceFiles(['/old/location/Voice.wav', '/old/location/Voice.wav'], [file]);
	assert.equal(matched.size, 1);
	assert.equal(matched.get('/old/location/Voice.wav'), file);
	assert.equal(matchClipSpreadsheetSourceFiles(['Voice.wav', './Voice.wav'], [file]).size, 2);
	assert.equal(matchClipSpreadsheetSourceFiles(['C:\\Audio\\VOICE.WAV'], [file]).get('C:\\Audio\\VOICE.WAV'), file);
});

test('exact relative paths distinguish files with the same basename', () => {
	const first = { name: 'take.wav', relativePath: 'first/take.wav' };
	const second = { name: 'take.wav', relativePath: 'second/take.wav' };
	const matched = matchClipSpreadsheetSourceFiles(['first/take.wav', 'second/take.wav'], [first, second]);
	assert.equal(matched.get('first/take.wav'), first);
	assert.equal(matched.get('second/take.wav'), second);
});

test('source matching rejects ambiguous basenames, reused different paths, missing and unrelated files', () => {
	const first = { name: 'take.wav', relativePath: 'first/take.wav' };
	const second = { name: 'take.wav', relativePath: 'second/take.wav' };
	assert.throws(() => matchClipSpreadsheetSourceFiles(['take.wav'], [first, second]), /ambiguous/u);
	assert.throws(() => matchClipSpreadsheetSourceFiles(['/a/take.wav', '/b/take.wav'], [{ name: 'take.wav' }]), /ambiguous/u);
	assert.throws(() => matchClipSpreadsheetSourceFiles(['first/take.wav'], [first, { ...first }]), /ambiguous/u);
	assert.throws(() => matchClipSpreadsheetSourceFiles(['take.wav'], [{ name: 'other.wav' }]), /missing/u);
	assert.throws(() => matchClipSpreadsheetSourceFiles(['take.wav'], []), /missing/u);
	assert.throws(() => matchClipSpreadsheetSourceFiles(['take.wav'], [{ name: 'take.wav' }, { name: 'other.wav' }]), /match/u);
	assert.throws(() => matchClipSpreadsheetSourceFiles([''], []), /reference/u);
	assert.throws(() => matchClipSpreadsheetSourceFiles(['https://example.com/take.wav'], [first]), /reference/u);
	assert.throws(() => matchClipSpreadsheetSourceFiles(['file:///tmp/take.wav?revision=1'], [first]), /reference/u);
});
