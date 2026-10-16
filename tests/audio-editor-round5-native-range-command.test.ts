/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { handleWorkspaceKeyboard } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const binding of [
	{ ctrlKey: true, altKey: true, metaKey: false, shortcut: 'Ctrl+Alt+Up' },
	{ ctrlKey: true, altKey: false, metaKey: false, shortcut: 'Ctrl+Up' },
	{ ctrlKey: false, altKey: false, metaKey: true, shortcut: 'Meta+Up' },
]) test(`a native range dispatches its configured ${binding.shortcut} command`, () => {
	const dom = installReactTestDom();
	try {
		const range = document.createElement('input'); range.setAttribute('type', 'range');
		document.body.appendChild(range);
		let calls = 0;
		const event = { key: 'ArrowUp', code: 'ArrowUp', target: range, ...binding,
			shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
		handleWorkspaceKeyboard(event, { preferences: { shortcuts: { 'new-label-track': [binding.shortcut] } } }, work => work(),
			{ menus: [{ id: 'new-label-track', onClick: () => { calls++; } }] });
		assert.equal(calls, 1);
		assert.equal(event.defaultPrevented, true, 'the native range must not also change its parameter');
	} finally { dom.restore(); }
});

for (const type of ['range', 'number', 'text']) test(`${type} retains its owned plain native editing keys`, () => {
	const dom = installReactTestDom();
	try {
		const input = document.createElement('input'); input.setAttribute('type', type); document.body.appendChild(input);
		for (const key of ['ArrowUp', 'Home', 'PageDown']) {
			let calls = 0;
			const event = { key, code: key, target: input, ctrlKey: false, altKey: false, metaKey: false,
				shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
			handleWorkspaceKeyboard(event, { preferences: { shortcuts: { 'new-label-track': [key] } } }, work => work(),
				{ menus: [{ id: 'new-label-track', onClick: () => { calls++; } }] });
			assert.equal(calls, 0); assert.equal(event.defaultPrevented, false);
		}
	} finally { dom.restore(); }
});
