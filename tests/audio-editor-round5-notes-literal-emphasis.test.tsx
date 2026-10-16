/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { formatRecordingNotes, parseRecordingNotesMarkdown } from '../src/common/editor/recording-notes-markdown.ts';
import RecordingNotesPanel from '../src/common/editor/ui/workspace/RecordingNotesPanel.tsx';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [format, kind, literal] of [
	['bold', 'strong', 'Use *.wav files'],
	['bold', 'strong', 'Record the _pickup'],
	['italic', 'emphasis', 'Use **.wav files'],
] as const) {
	test(`${format} previews a complete outer span with an unmatched literal delimiter: ${literal}`, () => {
		const formatted = formatRecordingNotes(literal, 0, literal.length, format, 'Placeholder');
		assert.deepEqual(parseRecordingNotesMarkdown(formatted.value), [{ kind: 'paragraph',
			content: [{ kind, content: [{ kind: 'text', text: literal }] }] }]);
		assert.equal(formatted.value.slice(formatted.selectionStart, formatted.selectionEnd), literal);
		assert.equal(formatRecordingNotes(formatted.value, formatted.selectionStart,
			formatted.selectionEnd, format, 'Placeholder').value, literal);
	});
}

test('the mounted Bold action renders an ordinary wildcard reminder without exposing its outer markers', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const literal = 'Use *.wav files';
	let value = literal;
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
		await act(async () => { reactProps(dom.one('[data-recording-notes-format="bold"]')).onClick(); });
		await act(async () => { reactProps(dom.one('[data-recording-notes-toggle]')).onClick(); });
		const preview = dom.one('[data-recording-notes-preview]');
		assert.equal(preview.querySelector('strong')?.textContent, literal);
		assert.equal(preview.textContent, literal);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
