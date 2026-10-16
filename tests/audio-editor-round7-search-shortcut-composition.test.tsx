/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorSearch from '../src/common/editor/ui/AudioEditorSearch.jsx';
import RecordingNotesPanel from '../src/common/editor/ui/workspace/RecordingNotesPanel.tsx';
import { WORKSPACE_LAYOUT_COPY_BY_LOCALE } from '../src/common/i18n/workspace-layout-copy.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const Search = AudioEditorSearch as unknown as React.ComponentType<Record<string, unknown>>;

for (const [isComposing, keyCode] of [[true, 75], [false, 229]] as const) {
	test(`global Search releases the notes input method (${isComposing ? 'composition' : 'native 229'})`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		globalThis.requestAnimationFrame = (callback) => { callback(0); return 1; };
		const listeners = new Set<EventListenerOrEventListenerObject>();
		document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (type === 'keydown' && listener) listeners.add(listener);
		};
		document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => {
			if (type === 'keydown' && listener) listeners.delete(listener);
		};
		const root = createRoot(dom.container as unknown as Element);
		function Fixture() {
			const [open, setOpen] = useState(false);
			return <><RecordingNotesPanel value="とう" disabled={false} copy={WORKSPACE_LAYOUT_COPY_BY_LOCALE.en}
				onChange={() => undefined} /><Search copy={{}} locale="en" open={open}
				onOpenChange={setOpen} onActivate={() => undefined} entries={[]} /></>;
		}
		try {
			await act(async () => root.render(<Fixture />));
			const notes = dom.one('[data-recording-notes-editor]');
			const input = dom.one('[data-editor-search-input]');
			const dispatch = async (composing: boolean, nativeCode: number): Promise<Event> => {
				const event = Object.assign(new Event('keydown', { cancelable: true }), {
					key: 'k', code: 'KeyK', ctrlKey: true, metaKey: false, altKey: false,
					shiftKey: false, isComposing: composing, keyCode: nativeCode,
				});
				Object.defineProperty(event, 'target', { value: notes });
				await act(async () => {
					for (const listener of listeners) {
						if (typeof listener === 'function') listener(event);
						else listener.handleEvent(event);
					}
				});
				return event;
			};
			notes.focus();
			assert.equal((await dispatch(false, 75)).defaultPrevented, true, 'ordinary Ctrl+K opens Search');
			assert.equal(dom.one('[data-editor-search]').getAttribute('data-editor-search-open'), 'true');
			assert.equal(dom.container.ownerDocument.activeElement, input);
			await act(async () => reactProps(input).onKeyDown({ key: 'Escape',
				nativeEvent: { isComposing: false, keyCode: 27 }, preventDefault() {}, stopPropagation() {} }));
			assert.equal(dom.container.ownerDocument.activeElement, notes);
			assert.equal((await dispatch(isComposing, keyCode)).defaultPrevented, false,
				'the native input method retains its conversion chord');
			assert.equal(dom.one('[data-editor-search]').getAttribute('data-editor-search-open'), 'false');
			assert.equal(dom.container.ownerDocument.activeElement, notes);
			assert.equal(notes.value, 'とう');
			assert.equal((await dispatch(false, 75)).defaultPrevented, true);
			assert.equal(dom.container.ownerDocument.activeElement, input);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}
