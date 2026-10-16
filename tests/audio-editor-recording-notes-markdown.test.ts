/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	formatRecordingNotes,
	parseRecordingNotesMarkdown,
} from '../src/common/editor/recording-notes-markdown.ts';

test('notes formatting wraps selected text and keeps the content selected', () => {
	assert.deepEqual(formatRecordingNotes('first take', 6, 10, 'bold', 'Bold'), {
		value: 'first **take**', selectionStart: 8, selectionEnd: 12,
	});
	assert.deepEqual(formatRecordingNotes('take', 0, 4, 'italic', 'Italic'), {
		value: '*take*', selectionStart: 1, selectionEnd: 5,
	});
	assert.deepEqual(formatRecordingNotes('take', 0, 4, 'code', 'Code'), {
		value: '`take`', selectionStart: 1, selectionEnd: 5,
	});
});

test('notes formatting inserts a selected placeholder and toggles existing markers', () => {
	assert.deepEqual(formatRecordingNotes('', 0, 0, 'bold', 'Bold'), {
		value: '**Bold**', selectionStart: 2, selectionEnd: 6,
	});
	assert.deepEqual(formatRecordingNotes('**take**', 2, 6, 'bold', 'Bold'), {
		value: 'take', selectionStart: 0, selectionEnd: 4,
	});
	assert.deepEqual(formatRecordingNotes('**take**', 0, 8, 'bold', 'Bold'), {
		value: 'take', selectionStart: 0, selectionEnd: 4,
	});
	assert.deepEqual(formatRecordingNotes('**take**', 2, 6, 'italic', 'Italic'), {
		value: '***take***', selectionStart: 3, selectionEnd: 7,
	});
	assert.deepEqual(formatRecordingNotes('***take***', 3, 7, 'italic', 'Italic'), {
		value: '**take**', selectionStart: 2, selectionEnd: 6,
	});
});

test('line formatting applies to whole selected lines and excludes an unselected next line', () => {
	assert.equal(formatRecordingNotes('first\nsecond\nthird', 2, 13, 'bullets', 'List').value,
		'- first\n- second\nthird');
	assert.equal(formatRecordingNotes('first\nsecond', 0, 6, 'heading', 'Heading').value,
		'# first\nsecond');
	assert.equal(formatRecordingNotes('first\nsecond', 0, 12, 'numbered-list', 'List').value,
		'1. first\n2. second');
});

test('line formatting replaces previous block markers and toggles matching blocks', () => {
	assert.equal(formatRecordingNotes('- first\n- second', 0, 16, 'numbered-list', 'List').value,
		'1. first\n2. second');
	assert.equal(formatRecordingNotes('# heading', 2, 9, 'heading', 'Heading').value, 'heading');
	assert.equal(formatRecordingNotes('- first\n- second', 0, 16, 'bullets', 'List').value,
		'first\nsecond');
	assert.equal(formatRecordingNotes('', 0, 0, 'heading', 'Heading').value, '# Heading');
	assert.equal(formatRecordingNotes('\nsecond', 0, 0, 'heading', 'Heading').value, '# Heading\nsecond');
});

test('formatting clamps stale or invalid selection offsets', () => {
	assert.equal(formatRecordingNotes('take', -10, 99, 'bold', 'Bold').value, '**take**');
	assert.equal(formatRecordingNotes('take', Number.NaN, Number.NaN, 'code', 'Code').value,
		'`Code`take');
});

test('Markdown notes parse headings, paragraphs and unordered and ordered lists', () => {
	assert.deepEqual(parseRecordingNotesMarkdown('# Session\n\nFirst take\nMic left\n\n- quiet\n- clean\n\n3. overdub\n4. mix'), [
		{ kind: 'heading', level: 1, content: [{ kind: 'text', text: 'Session' }] },
		{ kind: 'paragraph', content: [{ kind: 'text', text: 'First take\nMic left' }] },
		{ kind: 'list', ordered: false, start: 1, items: [
			[{ kind: 'text', text: 'quiet' }], [{ kind: 'text', text: 'clean' }],
		] },
		{ kind: 'list', ordered: true, start: 3, items: [
			[{ kind: 'text', text: 'overdub' }], [{ kind: 'text', text: 'mix' }],
		] },
	]);
});

test('Markdown notes parse emphasis and inline code without interpreting its content', () => {
	assert.deepEqual(parseRecordingNotesMarkdown('**bold** *soft* `**raw**`'), [
		{ kind: 'paragraph', content: [
			{ kind: 'strong', content: [{ kind: 'text', text: 'bold' }] },
			{ kind: 'text', text: ' ' },
			{ kind: 'emphasis', content: [{ kind: 'text', text: 'soft' }] },
			{ kind: 'text', text: ' ' },
			{ kind: 'code', text: '**raw**' },
		] },
	]);
	assert.deepEqual(parseRecordingNotesMarkdown('**bold and *soft***'), [
		{ kind: 'paragraph', content: [
			{ kind: 'strong', content: [
				{ kind: 'text', text: 'bold and ' },
				{ kind: 'emphasis', content: [{ kind: 'text', text: 'soft' }] },
			] },
		] },
	]);
});

test('HTML, unsupported links, escapes and unmatched Markdown remain text', () => {
	const text = '<img src=x onerror=alert(1)> [open](javascript:alert(1))';
	assert.deepEqual(parseRecordingNotesMarkdown(text), [
		{ kind: 'paragraph', content: [{ kind: 'text', text }] },
	]);
	assert.deepEqual(parseRecordingNotesMarkdown('\\*literal\\* and **unfinished'), [
		{ kind: 'paragraph', content: [{ kind: 'text', text: '*literal* and **unfinished' }] },
	]);
	assert.deepEqual(parseRecordingNotesMarkdown('  \r\n\r\n'), []);
});

test('Markdown parsing handles large literal note bodies without recursion', () => {
	const text = '<script>'.repeat(20_000);
	assert.deepEqual(parseRecordingNotesMarkdown(text), [
		{ kind: 'paragraph', content: [{ kind: 'text', text }] },
	]);
});

test('Markdown parsing stays bounded for malformed delimiter runs and preserves intraword underscores', () => {
	const text = '** _* '.repeat(20_000) + 'unfinished';
	assert.ok(parseRecordingNotesMarkdown(text).length);
	assert.deepEqual(parseRecordingNotesMarkdown('take_one_final'), [
		{ kind: 'paragraph', content: [{ kind: 'text', text: 'take_one_final' }] },
	]);
});
