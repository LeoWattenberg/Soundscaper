/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useApplicationMenuKeyboard } from '../src/common/editor/ui/useApplicationMenuKeyboard.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'handled'] as const) test(`the open application popup releases ${modifier} after plain endpoint navigation`, async () => {
	const dom = installReactTestDom();
	const listeners = new Set<EventListenerOrEventListenerObject>();
	window.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => {
		if (kind === 'keydown' && listener) listeners.add(listener);
	};
	window.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => {
		if (kind === 'keydown' && listener) listeners.delete(listener);
	};
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let closed = 0;
	let navigated = 0;
	function Menu() {
		useApplicationMenuKeyboard({ closeMenu: () => { closed += 1; }, flatNavigation: true,
			focusMenuButton: () => { navigated += 1; }, horizontalRightDelta: 1,
			menuButtonsRef: { current: [] }, menuCount: 2, openMenu: { index: 0 },
			setActiveIndex: () => undefined, setOpenMenu: () => undefined,
		});
		return <div className="kw-audio-editor__application-menu"><div role="menu">
			<button role="menuitem" data-first>First</button><button role="menuitem" data-last>Last</button>
		</div></div>;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const dispatch = async (event: Event) => {
		await act(async () => {
			for (const listener of [...listeners]) {
				if (typeof listener === 'function') listener(event);
				else listener.handleEvent(event);
			}
		});
	};
	try {
		await act(async () => { root.render(<Menu />); });
		const first = dom.one('[data-first]');
		const last = dom.one('[data-last]');
		const menu = dom.one('[role="menu"]');
		menu.querySelectorAll = (selector: string) => {
			assert.equal(selector, ':scope > [role="menuitem"]:not([aria-disabled="true"]), :scope > [role="menuitemcheckbox"]:not([aria-disabled="true"])');
			return [first, last];
		};
		first.focus();
		const key = (name: string) => {
			const event = Object.assign(new Event('keydown', { cancelable: true }), { key: name });
			Object.defineProperty(event, 'target', { value: first });
			return event;
		};
		await dispatch(key('End'));
		assert.equal(document.activeElement, last);
		await dispatch(key('Home'));
		assert.equal(document.activeElement, first);
		const modified = Object.assign(key('End'), {
			ctrlKey: modifier === 'ctrlKey', altKey: modifier === 'altKey', metaKey: modifier === 'metaKey',
		});
		if (modifier === 'handled') modified.preventDefault();
		await dispatch(modified);
		assert.equal(document.activeElement, first, 'an owned command cannot move popup focus');
		assert.equal(modified.defaultPrevented, modifier === 'handled');
		assert.equal(closed, 0);
		assert.equal(navigated, 0);
		await dispatch(key('Escape'));
		assert.equal(closed, 1);
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
