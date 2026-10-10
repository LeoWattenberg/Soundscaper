/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import RecordingNotesPanel from '../src/common/editor/ui/workspace/RecordingNotesPanel.tsx';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const nativeState of [{ isComposing: true, keyCode: 118 }, { isComposing: false, keyCode: 229 }]) {
	test(`workspace commands release native notes conversion (${nativeState.isComposing ? 'composition' : '229'})`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let calls = 0;
		try {
			await act(async () => root.render(<RecordingNotesPanel value="とう" disabled={false}
				copy={WORKSPACE_LAYOUT_COPY_BY_LOCALE.en} onChange={() => undefined} />));
			const notes = dom.one('[data-recording-notes-editor]');
			notes.value = 'とう';
			notes.focus();
			const dispatch = (nativeEvent: typeof nativeState): boolean => {
				let prevented = false;
				handleWorkspaceKeyboard({ key: 'F7', code: 'F7', altKey: false, ctrlKey: false,
					metaKey: false, shiftKey: false, defaultPrevented: false,
					target: notes as unknown as Element, nativeEvent,
					preventDefault() { prevented = true; } },
				{ preferences: { shortcuts: { 'new-label-track': ['F7'] } } }, operation => operation(),
				{ menus: [{ id: 'new-label-track', onClick: () => { calls += 1; } }] });
				return prevented;
			};
			assert.equal(dispatch({ isComposing: false, keyCode: 118 }), true);
			assert.equal(calls, 1, 'completed function-key shortcut remains available');
			assert.equal(dispatch(nativeState), false, 'the native input method owns conversion');
			assert.equal(calls, 1, 'unfinished composition cannot mutate the project');
			assert.equal(dom.container.ownerDocument.activeElement, notes);
			assert.equal(notes.value, 'とう');
			assert.equal(dispatch({ isComposing: false, keyCode: 118 }), true);
			assert.equal(calls, 2);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
