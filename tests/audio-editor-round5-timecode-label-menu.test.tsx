/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TimeCode } from '../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const target of ['format choice', 'submenu trigger', 'digit'] as const) test(`a labeled time control cancels native label activation for its ${target}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
		observe() {} disconnect() {}
	} });
	const formats: string[] = [];
	try {
		await act(async () => { root.render(<label>Duration<TimeCode value={1}
			onFormatChange={format => { formats.push(format); }} /></label>); });
		let clicked: ReactTestElement;
		if (target !== 'digit') {
			await act(async () => { reactProps(dom.one('.timecode__format-button')).onClick?.(); });
			const choice = dom.container.querySelectorAll('[role="menuitem"]')
				.find(item => target === 'format choice' ? item.textContent === 'samples'
					: item.textContent.startsWith('Video frames'));
			assert.ok(choice);
			clicked = choice;
		} else clicked = dom.one('.timecode-digit');
		clicked.focus();
		const event = new Event('click', { bubbles: true, cancelable: true });
		// React bubbles through the click's original host path, even when its
		// selected format removes the menu while that click is being handled.
		const path: ReactTestElement[] = [];
		for (let node: ReactTestElement | null = clicked; node && node !== dom.container;
			node = node.parentNode instanceof ReactTestElement ? node.parentNode : null) path.push(node);
		await act(async () => {
			for (const node of [...path].reverse()) reactProps(node).onClickCapture?.(event);
			for (const node of path) {
				reactProps(node).onClick?.(event);
				if (event.cancelBubble) break;
			}
		});
		assert.equal(event.defaultPrevented, true, 'the enclosing label must not click its format button afterward');
		if (target === 'format choice') {
			assert.deepEqual(formats, ['samples']);
			assert.equal(dom.find('[role="menu"]'), null);
		} else if (target === 'digit') {
			assert.equal(clicked.getAttribute('data-state'), 'active');
			assert.equal(document.activeElement, clicked as unknown as Element);
		} else {
			assert.deepEqual(formats, []);
			assert.ok(dom.find('[role="menu"]'));
		}
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
		else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});
