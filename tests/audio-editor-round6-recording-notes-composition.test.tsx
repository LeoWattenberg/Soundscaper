/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import RecordingNotesPanel from '../src/common/editor/ui/workspace/RecordingNotesPanel.tsx';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [key, ctrlKey, metaKey, expected] of [
	['b', true, false, '**とう**'], ['i', false, true, '*とう*'],
] as const) {
	for (const composing of [false, true]) test(`notes ${key} formatting ${composing ? 'releases native composition' : 'keeps ordinary completion'}`, async () => {
		const dom = installReactTestDom();
		const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let value = 'とう';
		const updates: string[] = [];
		const render = (): void => root.render(<RecordingNotesPanel value={value} disabled={false}
			copy={WORKSPACE_LAYOUT_COPY_BY_LOCALE.en}
			onChange={next => { updates.push(next); value = next; render(); }} />);
		try {
			await act(async () => render());
			const textarea = dom.one('[data-recording-notes-editor]');
			let start = 0, end = value.length;
			Object.defineProperties(textarea, {
				selectionStart: { configurable: true, get: () => start },
				selectionEnd: { configurable: true, get: () => end },
				setSelectionRange: { configurable: true, value: (nextStart: number, nextEnd: number) => {
					start = nextStart; end = nextEnd;
				} },
			});
			let prevented = false;
			await act(async () => reactProps(textarea).onKeyDown({
				key, ctrlKey, metaKey, altKey: false, shiftKey: false,
				nativeEvent: { isComposing: composing }, preventDefault() { prevented = true; },
			}));
			assert.equal(value, composing ? 'とう' : expected);
			assert.deepEqual(updates, composing ? [] : [expected]);
			assert.equal(prevented, !composing);
			assert.equal(dom.one('[data-recording-notes-editor]'), textarea);
		} finally {
			await act(async () => root.unmount());
			environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
