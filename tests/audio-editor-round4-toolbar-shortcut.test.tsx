/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { Toolbar } from '../vendor/audacity-design-system/components/src/Toolbar/Toolbar.tsx';
import { AccessibilityProfileProvider } from '../vendor/audacity-design-system/components/src/contexts/AccessibilityProfileContext.tsx';
import { handleEditorToolbarKeyDown } from '../src/common/editor/ui/workspace-shortcuts.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const phase of ['capture', 'bubble'] as const) test(`toolbar ${phase} leaves modified commands available while retaining ordinary navigation`, async () => {
	const dom = installReactTestDom();
	Object.defineProperty(window, 'getComputedStyle', { value: () => ({ display: '', visibility: '' }) });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<AccessibilityProfileProvider initialProfileId="au4-tab-groups"><section onKeyDownCapture={handleEditorToolbarKeyDown}>
			<Toolbar enableTabGroup><button className="play">Play</button><button className="stop">Stop</button></Toolbar>
		</section></AccessibilityProfileProvider>));
		const wrapper = dom.one('section');
		const toolbar = dom.one('.toolbar');
		const play = dom.one('.play');
		const stop = dom.one('.stop');
		for (const button of [play, stop]) {
			Object.defineProperty(button, 'getClientRects', { value: () => [{ width: 30, height: 30 }] });
			Object.defineProperty(button, 'matches', { value: () => false });
		}
		const query = wrapper.querySelector.bind(wrapper);
		Object.defineProperty(wrapper, 'querySelector', { value: (selector: string) => selector === '.toolbar[role="toolbar"]' ? toolbar : query(selector) });
		const dispatch = (key: string, modifiers: Record<string, boolean> = {}) => {
			let prevented = false;
			let stopped = false;
			const event = { key, target: play, currentTarget: phase === 'capture' ? wrapper : toolbar, ...modifiers,
				preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
			if (phase === 'capture') reactProps(wrapper).onKeyDownCapture?.(event);
			else reactProps(toolbar).onKeyDown?.(event);
			return { prevented, stopped };
		};
		for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
			for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
				play.focus();
				assert.deepEqual(dispatch(key, { [modifier]: true }), { prevented: false, stopped: false }, `${key} with ${modifier}`);
				assert.equal(play.ownerDocument.activeElement, play);
			}
		}
		play.focus();
		assert.equal(dispatch('ArrowRight').prevented, true);
		assert.equal(play.ownerDocument.activeElement, stop);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
});
