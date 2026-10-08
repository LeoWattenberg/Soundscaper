/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { formatRecordingNotes, parseRecordingNotesMarkdown } from '../src/common/editor/recording-notes-markdown.ts';
import RecordingNotesPanel from '../src/common/editor/ui/workspace/RecordingNotesPanel.tsx';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const format of ['bold', 'italic'] as const) test(`notes ${format} formats the content inside a whitespace-bearing selection`, () => {
	const marker = format === 'bold' ? '**' : '*';
	const value = '\t First take \n';
	const result = formatRecordingNotes(value, 0, value.length, format, 'placeholder');
	assert.deepEqual(result, { value: `\t ${marker}First take${marker} \n`,
		selectionStart: 2 + marker.length, selectionEnd: 12 + marker.length });
	assert.deepEqual(parseRecordingNotesMarkdown(result.value), [{ kind: 'paragraph', content: [
		{ kind: 'text', text: '\t ' },
		{ kind: format === 'bold' ? 'strong' : 'emphasis', content: [{ kind: 'text', text: 'First take' }] },
		{ kind: 'text', text: ' ' },
	] }]);
	assert.equal(formatRecordingNotes(result.value, 0, result.value.length, format, '').value, value);
	assert.deepEqual(formatRecordingNotes(' \t\n', 0, 3, format, 'placeholder'), {
		value: ' \t\n', selectionStart: 0, selectionEnd: 3,
	});
});

test('notes inline code preserves selected whitespace inside code delimiters', () => {
	assert.deepEqual(formatRecordingNotes(' take ', 0, 6, 'code', 'Code'), {
		value: '` take `', selectionStart: 1, selectionEnd: 7,
	});
});

test('the mounted notes panel restores the trimmed content selection and renders the authored emphasis', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let value = ' First take ';
	let start = 0;
	let end = value.length;
	const render = () => root.render(<RecordingNotesPanel value={value} disabled={false}
		copy={WORKSPACE_LAYOUT_COPY_BY_LOCALE.en} onChange={next => { value = next; render(); }} />);
	try {
		await act(async () => { render(); });
		const textarea = dom.one('[data-recording-notes-editor]');
		Object.defineProperties(textarea, {
			selectionStart: { configurable: true, get: () => start },
			selectionEnd: { configurable: true, get: () => end },
			setSelectionRange: { configurable: true, value: (nextStart: number, nextEnd: number) => {
				start = nextStart; end = nextEnd;
			} },
		});
		await act(async () => { reactProps(dom.one('[data-recording-notes-format="bold"]')).onClick?.(); });
		assert.equal(value, ' **First take** ');
		assert.deepEqual([start, end], [3, 13]);
		assert.equal(document.activeElement, textarea as unknown as Element);
		await act(async () => { reactProps(dom.one('[data-recording-notes-toggle]')).onClick?.(); });
		assert.equal(dom.one('[data-recording-notes-preview]').querySelector('strong')?.textContent, 'First take');
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
