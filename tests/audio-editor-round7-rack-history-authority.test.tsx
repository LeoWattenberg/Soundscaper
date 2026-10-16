/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ParameterNumber from '../src/common/editor/ui/inspector/EffectParameterNumber.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface KnobProps {
	onPointerDown(event: Readonly<Record<string, unknown>>): void;
	onPointerMove(event: Readonly<Record<string, unknown>>): void;
	onPointerUp(event: Readonly<Record<string, unknown>>): void;
}

for (const changed of [true, false]) test(`a held rack knob ${changed ? 'retires changed authored value' : 'retains unchanged authored value'}`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
	const calls: string[] = [];
	const render = async (value: number) => {
		await act(async () => { root.render(<ParameterNumber label="Mix" value={value}
			range={[0, 1]} step={.01} hook="mix" valueUnit="ratio" defaultValue={.2}
			disabled={false} timeCodeUnit={null} copy={{ parameterRangeError: 'Invalid {label}' }}
			onCommit={(next: number) => { calls.push(`atomic:${next}`); }}
			onGestureBegin={() => { calls.push('begin'); }}
			onGesturePreview={(next: number) => { calls.push(`preview:${next}`); }}
			onGestureCommit={(next: number) => { calls.push(`commit:${next}`); }}
			onGestureCancel={() => { calls.push('cancel'); }} />); });
	};
	const knob = () => {
		const element = dom.one('[role="slider"]');
		const target = element as typeof element & { setPointerCapture(id: number): void;
			hasPointerCapture(id: number): boolean; releasePointerCapture(id: number): void };
		const captured = new Set<number>();
		target.setPointerCapture = id => { captured.add(id); };
		target.hasPointerCapture = id => captured.has(id);
		target.releasePointerCapture = id => { captured.delete(id); };
		return target;
	};
	const pointer = (target: unknown, clientX = 100) => ({ currentTarget: target, pointerId: 1,
		pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true, clientX, clientY: 100,
		preventDefault() {}, stopPropagation() {} });
	try {
		await render(.4);
		const initial = knob(); assert.ok(initial);
		const handlers = reactProps(initial) as unknown as KnobProps;
		await act(async () => { handlers.onPointerDown(pointer(initial)); });
		await act(async () => { (reactProps(initial) as unknown as KnobProps).onPointerMove(pointer(initial, 112)); });
		assert.equal(initial.getAttribute('aria-valuenow'), '0.46');
		const priorHandlers = reactProps(initial) as unknown as KnobProps;
		await render(changed ? .2 : .4);
		assert.equal(knob()?.getAttribute('aria-valuenow'), changed ? '0.2' : '0.46');
		await act(async () => { priorHandlers.onPointerUp(pointer(initial, 112)); });
		assert.deepEqual(calls, changed ? ['begin', 'preview:0.46', 'cancel']
			: ['begin', 'preview:0.46', 'commit:0.46']);
		if (changed) {
			const fresh = knob(); assert.ok(fresh);
			await act(async () => { (reactProps(fresh) as unknown as KnobProps).onPointerDown(pointer(fresh)); });
			await act(async () => { (reactProps(fresh) as unknown as KnobProps).onPointerMove(pointer(fresh, 112)); });
			await act(async () => { (reactProps(fresh) as unknown as KnobProps).onPointerUp(pointer(fresh, 112)); });
			assert.deepEqual(calls.slice(-3), ['begin', 'preview:0.26', 'commit:0.26']);
		}
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
		else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
		dom.restore();
	}
});
