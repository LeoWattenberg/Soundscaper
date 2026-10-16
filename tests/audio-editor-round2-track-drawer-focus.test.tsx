/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useTrackHeaderDrawerDismissal } from '../src/common/editor/ui/timeline/useTrackHeaderDrawerDismissal.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('closing compact track headers returns focus after the header controls are hidden', async () => {
	const platform = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = platform.React;
	const previousAct = platform.IS_REACT_ACT_ENVIRONMENT;
	platform.React = React;
	platform.IS_REACT_ACT_ENVIRONMENT = true;
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	function Fixture() {
		const [isOpen, setOpen] = useState(true);
		const dismissal = useTrackHeaderDrawerDismissal({
			drawer: { isOpen, close: () => setOpen(false) }, onPointerDown: () => undefined,
		});
		return <div data-timeline onKeyDown={dismissal.onKeyDown}>
			<button data-track-header-toggle aria-expanded={isOpen} />
			<div data-track-header hidden={!isOpen}><button data-track-menu /></div>
		</div>;
	}
	try {
		await act(async () => root.render(<Fixture />));
		const timeline = dom.one('[data-timeline]');
		const menu = dom.one('[data-track-menu]');
		const toggle = dom.one('[data-track-header-toggle]');
		menu.focus();
		const key = (defaultPrevented: boolean, isComposing = false) => ({
			key: 'Escape', defaultPrevented, nativeEvent: { isComposing }, target: menu, currentTarget: timeline,
			preventDefault() {},
		});
		await act(async () => reactProps(timeline).onKeyDown(key(true)));
		assert.equal(toggle.getAttribute('aria-expanded'), 'true');
		assert.equal(document.activeElement, menu);
		await act(async () => reactProps(timeline).onKeyDown(key(false, true)));
		assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'native composition retains the header and its focused control');
		assert.equal(document.activeElement, menu);
		await act(async () => reactProps(timeline).onKeyDown(key(false)));
		assert.equal(toggle.getAttribute('aria-expanded'), 'false');
		assert.equal(document.activeElement, toggle);
	} finally {
		await act(async () => root.unmount());
		dom.restore();
		platform.React = previousReact;
		platform.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
