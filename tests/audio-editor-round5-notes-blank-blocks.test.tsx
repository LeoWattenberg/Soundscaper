/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { formatRecordingNotes } from '../src/common/editor/recording-notes-markdown.ts';
import RecordingNotesPanel from '../src/common/editor/ui/workspace/RecordingNotesPanel.tsx';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const format of ['heading', 'bullets', 'numbered-list'] as const) {
	test(`${format} preserves selected blank separators and removes only its own block markers`, () => {
		const literal = 'First take\n\nSecond take';
		const expected = format === 'heading' ? '# First take\n\n# Second take'
			: format === 'bullets' ? '- First take\n\n- Second take' : '1. First take\n\n2. Second take';
		const formatted = formatRecordingNotes(literal, 0, literal.length, format, 'Placeholder');
		assert.equal(formatted.value, expected);
		assert.equal(formatRecordingNotes(formatted.value, formatted.selectionStart,
			formatted.selectionEnd, format, 'Placeholder').value, literal);
		assert.equal(formatRecordingNotes('', 0, 0, format, 'Placeholder').value.includes('Placeholder'), true);
		assert.equal(formatRecordingNotes('\n\n', 0, 2, format, 'Placeholder').value, '\n\n');
	});
}

test('the mounted Numbered list action does not invent a note in the selected empty paragraph', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let value = 'First take\n\nSecond take';
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
		await act(async () => { reactProps(dom.one('[data-recording-notes-format="numbered-list"]')).onClick(); });
		assert.equal(value, '1. First take\n\n2. Second take');
		await act(async () => { reactProps(dom.one('[data-recording-notes-toggle]')).onClick(); });
		const preview = dom.one('[data-recording-notes-preview]');
		assert.equal(preview.querySelectorAll('li').length, 2);
		assert.equal(preview.textContent, 'First takeSecond take');
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
