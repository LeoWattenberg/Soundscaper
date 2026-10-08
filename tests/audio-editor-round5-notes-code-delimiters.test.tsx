/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { formatRecordingNotes, parseRecordingNotesMarkdown } from '../src/common/editor/recording-notes-markdown.ts';
import RecordingNotesPanel from '../src/common/editor/ui/workspace/RecordingNotesPanel.tsx';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const literal of ['echo `date`', 'record ``take`` then `pickup`', ' use `mic A` ', '`mic A` for pickup', 'literal ```take``` then pickup']) {
	test(`Code preserves literal delimiters and toggles its own complete span: ${literal}`, () => {
		const formatted = formatRecordingNotes(literal, 0, literal.length, 'code', 'Code');
		assert.deepEqual(parseRecordingNotesMarkdown(formatted.value), [
			{ kind: 'paragraph', content: [{ kind: 'code', text: literal }] },
		]);
		assert.equal(formatted.value.slice(formatted.selectionStart, formatted.selectionEnd), literal);
		assert.equal(formatRecordingNotes(formatted.value, formatted.selectionStart,
			formatted.selectionEnd, 'code', 'Code').value, literal);
		assert.equal(formatRecordingNotes(formatted.value, 0, formatted.value.length, 'code', 'Code').value, literal);
	});
}

test('the mounted Code action restores the literal selection and previews a single uninterpreted span', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const literal = 'echo `date`';
	let value = literal;
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
		await act(async () => { reactProps(dom.one('[data-recording-notes-format="code"]')).onClick?.(); });
		assert.equal(value.slice(start, end), literal);
		assert.equal(document.activeElement, textarea as unknown as Element);
		await act(async () => { reactProps(dom.one('[data-recording-notes-toggle]')).onClick?.(); });
		assert.equal(dom.one('[data-recording-notes-preview]').querySelector('code')?.textContent, literal);
		await act(async () => { reactProps(dom.one('[data-recording-notes-toggle]')).onClick?.(); });
		await act(async () => { reactProps(dom.one('[data-recording-notes-format="code"]')).onClick?.(); });
		assert.equal(value, literal);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
