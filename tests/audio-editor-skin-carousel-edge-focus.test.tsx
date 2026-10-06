/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import SkinCarousel from '../src/common/editor/ui/skins/SkinCarousel.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('terminal skin carousel actions stay focusable and suppress unavailable browsing', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const globals = new Map(['ResizeObserver', 'getComputedStyle'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	const geometry = new Map(['clientWidth', 'scrollWidth', 'scrollLeft', 'scrollBy'].map((key) => [key, Object.getOwnPropertyDescriptor(ReactTestElement.prototype, key)]));
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class {
		observe() {} disconnect() {}
	} });
	Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ direction: 'ltr' }) });
	let position = 0;
	let browses = 0;
	Object.defineProperties(ReactTestElement.prototype, {
		clientWidth: { configurable: true, get: () => 100 },
		scrollWidth: { configurable: true, get: () => 200 },
		scrollLeft: { configurable: true, get: () => position },
		scrollBy: { configurable: true, value(this: ReactTestElement, options: { left: number }) {
			browses++;
			position = Math.max(0, Math.min(100, position + options.left));
			reactProps(this).onScroll({});
		} },
	});
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<SkinCarousel current="default" copy={{ skin: 'Skin', skinPrevious: 'Previous skins', skinNext: 'Next skins' }}>
			<button type="button">Default</button><button type="button">Techno</button>
		</SkinCarousel>));
		const [previous, next] = dom.container.querySelectorAll('.editor-skin-carousel__step');
		assert.ok(previous && next);
		assert.equal(previous.getAttribute('aria-disabled'), 'true');
		await act(async () => reactProps(previous).onClick({}));
		assert.equal(browses, 0);
		next.focus();
		await act(async () => { reactProps(next).onClick({}); reactProps(next).onClick({}); });
		assert.equal(next.getAttribute('aria-disabled'), 'true');
		assert.equal(next.disabled, false);
		assert.equal(document.activeElement, next);
		await act(async () => reactProps(next).onClick({}));
		assert.equal(browses, 2);
		await act(async () => reactProps(previous).onClick({}));
		assert.equal(next.getAttribute('aria-disabled'), 'false');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		for (const [key, descriptor] of globals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
		for (const [key, descriptor] of geometry) {
			if (descriptor) Object.defineProperty(ReactTestElement.prototype, key, descriptor);
			else Reflect.deleteProperty(ReactTestElement.prototype, key);
		}
		dom.restore();
	}
});
