/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RulerFlyout } from '@soundscaper/design-system/RulerFlyout';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const key of ['Escape', 'Enter']) test(`the frequency flyout retains native composing ${key}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const owner = dom.container.ownerDocument as unknown as Document;
	const listeners = new Set<EventListenerOrEventListenerObject>();
	owner.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null): void => {
		if (type === 'keydown' && listener) listeners.add(listener);
	};
	owner.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null): void => {
		if (type === 'keydown' && listener) listeners.delete(listener);
	};
	const changes: number[] = [];
	let closed = 0;
	try {
		await act(async () => { root.render(<RulerFlyout isOpen x={0} y={0} mode="spectrogram"
			onClose={() => { closed++; }} minFreq={0} maxFreq={20_000}
			onMaxFreqChange={(value) => { changes.push(value); }} />); });
		const input = dom.container.querySelectorAll('input').filter(node => node.type === 'text')[1];
		assert.ok(input?.parentNode?.parentNode instanceof ReactTestElement);
		const field = input.parentNode.parentNode;
		await act(async () => { reactProps(input).onChange({ target: { value: '1e3' } }); });
		await act(async () => { reactProps(field).onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false } }); });
		assert.deepEqual(changes, [1000], 'completed scientific entry still commits');
		changes.length = 0;
		input.focus();
		await act(async () => { reactProps(input).onChange({ target: { value: '2e3' } }); });
		let claimed = 0;
		if (key === 'Enter') {
			await act(async () => { reactProps(field).onKeyDown({ key, nativeEvent: { isComposing: true } }); });
		} else {
			const event = { key, isComposing: true, target: input,
				preventDefault() { claimed++; }, stopPropagation() { claimed++; }, stopImmediatePropagation() { claimed++; } } as unknown as KeyboardEvent;
			await act(async () => {
				for (const listener of listeners) {
					if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
				}
			});
		}
		assert.equal(closed, 0, 'native composition cannot dismiss its flyout');
		assert.equal(claimed, 0);
		assert.deepEqual(changes, [], 'native composition cannot publish its unfinished frequency');
		assert.equal(input.value, '2e3');
		assert.equal(dom.container.ownerDocument.activeElement === input, true);
		await act(async () => { reactProps(field).onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false } }); });
		assert.deepEqual(changes, [2000]);
	} finally {
		await act(async () => { root.unmount(); });
		assert.equal(listeners.size, 0);
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
