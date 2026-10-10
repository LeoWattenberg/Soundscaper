/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom, type ReactTestElement } from './helpers/react-test-dom.ts';

for (const key of ['Enter', ' '] as const) {
	test(`native drawer retains its ${key === ' ' ? 'Space' : key} activation without editor commands`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let commands = 0;
		try {
			await act(async () => root.render(<div><button type="button" data-native-button>Action</button>
				<details><summary data-native-summary><h3>Media settings</h3></summary><input /></details></div>));
			const dispatch = (target: ReactTestElement, ctrlKey = false) => {
				let prevented = false;
				handleWorkspaceKeyboard({ key, code: key === ' ' ? 'Space' : 'Enter',
					ctrlKey, metaKey: false, altKey: false, shiftKey: false,
					defaultPrevented: false, target: target as unknown as Element,
					preventDefault() { prevented = true; } },
				{ preferences: { shortcuts: { 'new-label-track': [ctrlKey ? `Ctrl+${key === ' ' ? 'Space' : key}` : key === ' ' ? 'Space' : key] } } },
				operation => operation(), { menus: [{ id: 'new-label-track', onClick: () => { commands += 1; } }] });
				return prevented;
			};
			assert.equal(dispatch(dom.container), true);
			assert.equal(commands, 1, 'the ordinary command remains usable from the editor');
			assert.equal(dispatch(dom.one('[data-native-button]')), false);
			assert.equal(commands, 1, 'existing native action buttons retain activation');
			const summary = dom.one('[data-native-summary]');
			summary.focus();
			assert.equal(dispatch(summary), false, 'the native drawer owns activation');
			assert.equal(commands, 1, 'drawer activation must not change project selection or transport');
			assert.equal(dispatch(summary, true), true, 'configured modified commands remain available');
			assert.equal(commands, 2);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		}
	});
}
