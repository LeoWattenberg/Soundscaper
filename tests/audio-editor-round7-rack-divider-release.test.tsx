/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { EffectsPanel } from '../vendor/audacity-design-system/components/src/EffectsPanel/EffectsPanel.tsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const button of [1, 2]) test(`the real rack divider retains its primary resize after button ${button} releases`, async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' }) as CSSStyleDeclaration;
	const priorClassList = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'classList');
	Object.defineProperty(ReactTestElement.prototype, 'classList', { configurable: true,
		get(this: ReactTestElement) { return { contains: (token: string) => (this.getAttribute('class') ?? '').split(/\s+/u).includes(token) }; },
	});
	const events = new EventTarget();
	const documentView = dom.container.ownerDocument as unknown as Document;
	documentView.addEventListener = events.addEventListener.bind(events);
	documentView.removeEventListener = events.removeEventListener.bind(events);
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<EffectsPanel autoFocusOnOpen={false}
			trackSection={{ trackName: 'Recording', effects: [], allEnabled: true }}
			masterSection={{ effects: [], allEnabled: true }} />));
		const content = dom.one('.effects-panel__content');
		Object.defineProperty(content, 'getBoundingClientRect', { value: () => ({ bottom: 500, height: 500 }) });
		const handle = dom.one('.effects-panel__vertical-resize-handle');
		const master = content.querySelector('.effects-panel__master-section')!;
		const height = () => (reactProps(master) as unknown as { style: { height: number } }).style.height;
		const dispatch = async (type: string, properties: Readonly<Record<string, number>>) => {
			const event = new Event(type);
			for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
			await act(async () => { events.dispatchEvent(event); });
		};
		const begin = async (pressedButton: number) => {
			await act(async () => reactProps(handle).onMouseDown({ button: pressedButton, preventDefault() {} }));
		};
		await begin(0);
		await dispatch('mousemove', { clientY: 250 });
		assert.equal(height(), 250);
		await dispatch('mouseup', { button: 0, buttons: 0 });
		assert.doesNotMatch(handle.getAttribute('class') ?? '', /--active/u);
		await begin(0);
		await dispatch('mousemove', { clientY: 220 });
		assert.equal(height(), 280);
		await dispatch('mouseup', { button, buttons: 1 });
		await dispatch('mousemove', { clientY: 190 });
		assert.equal(height(), 310, 'the primary mouse remains held and can continue resizing');
		await dispatch('mouseup', { button: 0, buttons: 0 });
		assert.doesNotMatch(handle.getAttribute('class') ?? '', /--active/u);
		await begin(button);
		await dispatch('mousemove', { clientY: 160 });
		assert.equal(height(), 310, 'an auxiliary press cannot start a new primary resize');
	} finally {
		await act(async () => root.unmount());
		if (priorClassList) Object.defineProperty(ReactTestElement.prototype, 'classList', priorClassList);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'classList');
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
