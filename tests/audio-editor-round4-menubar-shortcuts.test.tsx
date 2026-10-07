/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorMenuBar from '../src/common/editor/ui/AudioEditorMenuBar.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const modified of [true, false]) {
	test(`top-level menubar preserves ${modified ? 'modified commands' : 'plain navigation'}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = global.IS_REACT_ACT_ENVIRONMENT;
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		global.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		try {
			await act(async () => { root.render(<AudioEditorMenuBar appName="Soundscaper" copy={ENGLISH_COPY}
				locale="en" menus={[{ id: 'file', label: 'File', items: [] }, { id: 'help', label: 'Help', items: [] }]}
				onAssistanceSearchClose={() => undefined} onFullscreen={() => undefined} onSearchActivate={() => undefined}
				projectTabs={null} projectName="Untitled" saveState="saved" saveText="Saved" />); });
			const file = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'File');
			const help = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'Help');
			assert.ok(file); assert.ok(help);
			for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
				for (const modifier of modified ? ['ctrlKey', 'altKey', 'metaKey', 'defaultPrevented'] : ['plain']) {
					file.focus(); let prevented = false;
					await act(async () => { reactProps(file).onKeyDown?.({ key,
						ctrlKey: modifier === 'ctrlKey', altKey: modifier === 'altKey', metaKey: modifier === 'metaKey',
						defaultPrevented: modifier === 'defaultPrevented', preventDefault() { prevented = true; } }); });
					assert.equal(prevented, !modified, `${modifier} ${key}`);
					if (modified) assert.equal(document.activeElement, file);
					else if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'End') assert.equal(document.activeElement, help);
					// Close an opened menu through its public Close/Escape owner before the next gesture.
					if (!modified && (key === 'ArrowUp' || key === 'ArrowDown')) {
						await act(async () => { reactProps(file).onKeyDown?.({ key: 'Escape', preventDefault() {} }); });
					}
				}
			}
		} finally {
			await act(async () => { root.unmount(); });
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore(); global.IS_REACT_ACT_ENVIRONMENT = priorAct;
		}
	});
}
