/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ParametricEqEditor } from '../src/common/editor/ui/ParametricEqEditor.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

for (const variant of ['secondary-down', 'foreign-up', 'foreign-cancel', 'own-completion'] as const) {
	test(`the output EQ fader keeps its own gesture through ${variant}`, async () => {
		const dom = installReactTestDom();
		const root = createRoot(dom.container as unknown as HTMLElement);
		const prior = new Map<string, PropertyDescriptor | undefined>();
		for (const [key, value] of Object.entries({ React, IS_REACT_ACT_ENVIRONMENT: true })) {
			prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
			Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
		}
		const priorContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
		Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
		const committed: number[] = [];
		const canceled: number[] = [];
		const captures: number[] = [];
		const params = { outputGain: 0, bands: [{ id: 'band', enabled: true, type: 'peaking',
			frequency: 1000, gain: 0, q: 1, slope: 12 }] };
		try {
			await act(async () => { root.render(<ParametricEqEditor params={params} effectId="eq" onGestureBegin={() => undefined}
				onPreview={undefined} onCommit={(next: { outputGain: number }) => { committed.push(next.outputGain); }}
				onCancel={(next: { outputGain: number }) => { canceled.push(next.outputGain); }}
				onAudition={undefined} readSpectrum={undefined} parameterAutomation={undefined} />); });
			const slider = (): ReactTestElement => {
				const found = dom.one('.audio-editor-parametric-eq__output').querySelectorAll('input').find(node => node.type === 'range');
				assert.ok(found); return found;
			};
			const send = async (handler: string, event: Readonly<Record<string, unknown>>): Promise<void> => {
				await act(async () => { reactProps(slider())[handler]?.({ currentTarget: { hasPointerCapture: () => false }, ...event }); });
			};
			const start = (pointerId: number, isPrimary = true, preventDefault = (): void => undefined) => ({
				pointerId, pointerType: 'touch', isPrimary, button: 0, preventDefault,
				currentTarget: { setPointerCapture(id: number) { captures.push(id); } },
			});
			await send('onPointerDown', start(1));
			await send('onChange', { currentTarget: { value: '2' } });
			assert.equal(slider().value, '2');
			if (variant === 'secondary-down') {
				let consumed = false;
				await send('onPointerDown', start(2, false, () => { consumed = true; }));
				assert.equal(consumed, true, 'the second finger must not replace the native browser range drag');
				assert.deepEqual(captures, [1]);
			} else if (variant !== 'own-completion') {
				await send(variant === 'foreign-up' ? 'onPointerUp' : 'onPointerCancel', { pointerId: 2 });
			}
			assert.deepEqual(committed, []);
			assert.deepEqual(canceled, []);
			assert.equal(slider().value, '2');
			await send('onChange', { currentTarget: { value: '4' } });
			await send('onPointerUp', { pointerId: 1 });
			assert.deepEqual(committed, [4]);
			await send('onPointerDown', start(3));
			await send('onChange', { currentTarget: { value: '6' } });
			await send('onPointerCancel', { pointerId: 3 });
			assert.deepEqual(canceled, [4], 'a later owning cancellation restores that gesture start');
			assert.equal(slider().value, '4');
		} finally {
			await act(async () => { root.unmount(); });
			if (priorContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', priorContext);
			else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
			for (const [key, descriptor] of prior) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		}
	});
}
