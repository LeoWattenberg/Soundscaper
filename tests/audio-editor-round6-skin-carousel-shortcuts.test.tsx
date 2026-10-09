/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SkinCarousel from '../src/common/editor/ui/skins/SkinCarousel.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const variant of [
	{ key: 'End', ctrlKey: true }, { key: 'Home', metaKey: true },
	{ key: 'ArrowRight', altKey: true }, { key: 'ArrowLeft', defaultPrevented: true },
	{ key: 'Home' },
] as const) test(`skin carousel releases ${JSON.stringify(variant)}`, async () => {
	const dom = installReactTestDom();
	const globals = new Map(['ResizeObserver', 'getComputedStyle', 'HTMLButtonElement',
		'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.defineProperties(globalThis, {
		IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
		HTMLButtonElement: { configurable: true, value: ReactTestElement },
		ResizeObserver: { configurable: true, value: class { observe() {} disconnect() {} } },
		getComputedStyle: { configurable: true, value: () => ({ direction: 'ltr' }) },
	});
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SkinCarousel current="default" copy={{ skin: 'Skin' }}>
			<button type="button">Default</button><button type="button">Contrast</button><button type="button">Techno</button>
		</SkinCarousel>));
		const buttons = dom.one('.editor-skin-choices').querySelectorAll('button');
		const current = buttons[1];
		assert.ok(current);
		current.focus();
		let prevented = false;
		await act(async () => reactProps(dom.one('.editor-skin-choices')).onKeyDown({
			target: current, ctrlKey: false, metaKey: false, altKey: false,
			defaultPrevented: false, ...variant, preventDefault() { prevented = true; },
		}));
		const ordinary = Object.keys(variant).length === 1;
		assert.equal(document.activeElement, ordinary ? buttons[0] : current);
		assert.equal(prevented, ordinary);
	} finally {
		await act(async () => root.unmount());
		for (const [key, descriptor] of globals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
		dom.restore();
	}
});
