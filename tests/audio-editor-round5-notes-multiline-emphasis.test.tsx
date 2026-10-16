/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { formatRecordingNotes, parseRecordingNotesMarkdown } from '../src/common/editor/recording-notes-markdown.ts';
import RecordingNotesPanel from '../src/common/editor/ui/workspace/RecordingNotesPanel.tsx';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [format, kind, marker] of [['bold', 'strong', '**'], ['italic', 'emphasis', '*']] as const) {
	test(`${format} preserves selected paragraph boundaries, separators and its toggle`, () => {
		const value = ' First take \n\n Pickup notes ';
		const formatted = formatRecordingNotes(value, 0, value.length, format, 'Placeholder');
		assert.equal(formatted.value, ` ${marker}First take${marker} \n\n ${marker}Pickup notes${marker} `);
		assert.deepEqual(parseRecordingNotesMarkdown(formatted.value), [
			{ kind: 'paragraph', content: [{ kind: 'text', text: ' ' },
				{ kind, content: [{ kind: 'text', text: 'First take' }] }, { kind: 'text', text: ' ' }] },
			{ kind: 'paragraph', content: [{ kind: 'text', text: ' ' },
				{ kind, content: [{ kind: 'text', text: 'Pickup notes' }] }, { kind: 'text', text: ' ' }] },
		]);
		assert.equal(formatRecordingNotes(formatted.value, formatted.selectionStart,
			formatted.selectionEnd, format, 'Placeholder').value, value);
	});
}

test('multiline emphasis preserves existing headings and list structure', () => {
	const value = '# First take\n\n- Pickup notes';
	const formatted = formatRecordingNotes(value, 0, value.length, 'bold', 'Placeholder');
	assert.equal(formatted.value, '# **First take**\n\n- **Pickup notes**');
	assert.deepEqual(parseRecordingNotesMarkdown(formatted.value), [
		{ kind: 'heading', level: 1, content: [{ kind: 'strong', content: [{ kind: 'text', text: 'First take' }] }] },
		{ kind: 'list', ordered: false, start: 1, items: [[{ kind: 'strong', content: [{ kind: 'text', text: 'Pickup notes' }] }]] },
	]);
	assert.equal(formatRecordingNotes(formatted.value, formatted.selectionStart,
		formatted.selectionEnd, 'bold', 'Placeholder').value, value);
});

test('partial multiline selection leaves unselected text and blank separators unchanged', () => {
	const value = 'Before First\n\nSecond After';
	const formatted = formatRecordingNotes(value, 7, 20, 'bold', 'Placeholder');
	assert.equal(formatted.value, 'Before **First**\n\n**Second** After');
	assert.equal(formatRecordingNotes(formatted.value, formatted.selectionStart,
		formatted.selectionEnd, 'bold', 'Placeholder').value, value);
});

for (const literal of ['echo first\n\necho second', 'echo `mic A`\n\nrecord ``pickup``', 'Before echo `first`\n\nrecord `second` After']) {
	test(`multiline Code retains literal commands and toggles both delimiter lengths: ${literal}`, () => {
		const partial = literal.startsWith('Before ');
		const start = partial ? 7 : 0;
		const end = partial ? literal.length - 6 : literal.length;
		const selected = literal.slice(start, end).split('\n').filter(Boolean);
		const formatted = formatRecordingNotes(literal, start, end, 'code', 'Code');
		const tree = parseRecordingNotesMarkdown(formatted.value);
		assert.equal(tree.length, 2);
		assert.deepEqual(tree.map(block => block.kind === 'paragraph'
			? block.content.filter(token => token.kind === 'code').map(token => token.text) : []),
			selected.map(text => [text]));
		assert.equal(formatRecordingNotes(formatted.value, formatted.selectionStart,
			formatted.selectionEnd, 'code', 'Code').value, literal);
	});
}

test('multiline Code still toggles existing complete spans rather than treating their markers as text', () => {
	const value = '`mic A`\n\n``pickup``';
	assert.equal(formatRecordingNotes(value, 0, value.length, 'code', 'Code').value, 'mic A\n\npickup');
});

for (const [action, element] of [['bold', 'strong'], ['code', 'code']] as const) {
	test(`mounted notes ${action} previews two paragraphs and toggles back with retained selection`, async () => {
		const dom = installReactTestDom();
		const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
		actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const original = 'First take\n\nPickup notes';
		let value = original;
		let start = 0;
		let end = value.length;
		const render = () => root.render(<RecordingNotesPanel value={value} disabled={false}
			copy={WORKSPACE_LAYOUT_COPY_BY_LOCALE.en} onChange={next => { value = next; render(); }} />);
		try {
			await act(async () => { render(); });
			Object.defineProperties(dom.one('[data-recording-notes-editor]'), {
				selectionStart: { configurable: true, get: () => start },
				selectionEnd: { configurable: true, get: () => end },
				setSelectionRange: { configurable: true, value: (nextStart: number, nextEnd: number) => {
					start = nextStart; end = nextEnd;
				} },
			});
			await act(async () => { reactProps(dom.one(`[data-recording-notes-format="${action}"]`)).onClick(); });
			await act(async () => { reactProps(dom.one('[data-recording-notes-toggle]')).onClick(); });
			const preview = dom.one('[data-recording-notes-preview]');
			assert.deepEqual(preview.querySelectorAll(element).map(node => node.textContent), ['First take', 'Pickup notes']);
			assert.equal(preview.querySelectorAll('p').length, 2);
			await act(async () => { reactProps(dom.one('[data-recording-notes-toggle]')).onClick(); });
			await act(async () => { reactProps(dom.one(`[data-recording-notes-format="${action}"]`)).onClick(); });
			assert.equal(value, original);
		} finally {
			await act(async () => { root.unmount(); });
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
