/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { SteppedSlider } from '../src/common/editor/ui/inspector/inspector-controls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Pointer {
	readonly pointerId: number;
	readonly button: number;
	readonly isPrimary: boolean;
	preventDefault(): void;
}
interface InputProps {
	onPointerDown(event: Pointer): void;
	onPointerUp(event: Pointer): void;
	onPointerCancel(event: Pointer): void;
	onChange(event: { currentTarget: { value: string } }): void;
	onKeyDown(event: { key: string; preventDefault(): void; stopPropagation(): void }): void;
}

async function mounted(run: (props: InputProps, calls: string[]) => void): Promise<void> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	try {
		await act(async () => root.render(<SteppedSlider value={.5} min={0} max={1} step={.01}
			ariaLabel="Mix" onChange={(value: number) => { calls.push(`change:${value}`); }}
			onGestureStart={() => { calls.push('begin'); }} onGestureEnd={(value: number) => { calls.push(`end:${value}`); }}
			onGestureCancel={() => { calls.push('cancel'); }} />));
		const props = reactProps(dom.one('input')) as unknown as InputProps;
		await act(async () => { run(props, calls); });
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}

const pointer = (pointerId: number, primary = true, button = 0): Pointer => ({ pointerId, isPrimary: primary, button, preventDefault() {} });

test('the shared native slider prevents a second pointer default before it can steal the held range', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer(7));
		let prevented = false;
		props.onPointerDown({ ...pointer(8, false), preventDefault() { prevented = true; } });
		assert.equal(prevented, true);
		assert.deepEqual(calls, ['begin']);
	});
});

for (const end of ['onPointerUp', 'onPointerCancel'] as const) {
	test(`the shared native slider ignores another pointer's ${end}`, async () => {
		await mounted((props, calls) => {
			props.onPointerDown(pointer(7));
			props.onChange({ currentTarget: { value: '.6' } });
			props[end](pointer(8, false));
			assert.deepEqual(calls, ['begin', 'change:0.6']);
			props.onChange({ currentTarget: { value: '.8' } });
			props.onPointerUp(pointer(7));
			assert.deepEqual(calls, ['begin', 'change:0.6', 'change:0.8', 'end:0.8']);
		});
	});
}

test('the shared native slider refuses nonprimary buttons without starting a transaction', async () => {
	await mounted((props, calls) => {
		let prevented = false;
		props.onPointerDown({ ...pointer(7, true, 2), preventDefault() { prevented = true; } });
		assert.equal(prevented, true);
		assert.deepEqual(calls, []);
	});
});

test('the shared native slider completes the owning primary range gesture once', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer(7));
		props.onChange({ currentTarget: { value: '.6' } });
		props.onChange({ currentTarget: { value: '.8' } });
		props.onPointerUp(pointer(7));
		props.onPointerUp(pointer(7));
		assert.deepEqual(calls, ['begin', 'change:0.6', 'change:0.8', 'end:0.8']);
	});
});


test('canceling the owning pointer restores the held draft before a later healthy gesture', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer(7));
		props.onChange({ currentTarget: { value: '.6' } });
		props.onPointerCancel(pointer(7));
		const late = { currentTarget: { value: '.8' } };
		props.onChange(late);
		assert.equal(late.currentTarget.value, '0.5');
		assert.deepEqual(calls, ['begin', 'change:0.6', 'cancel']);
		props.onPointerDown(pointer(9));
		props.onChange({ currentTarget: { value: '.7' } });
		props.onPointerUp(pointer(9));
		assert.deepEqual(calls, ['begin', 'change:0.6', 'cancel', 'begin', 'change:0.7', 'end:0.7']);
	});
});

test('Escape keeps restoring a canceled held pointer after another finger releases', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer(7));
		props.onChange({ currentTarget: { value: '.6' } });
		props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
		props.onPointerUp(pointer(8, false));
		const late = { currentTarget: { value: '.8' } };
		props.onChange(late);
		assert.equal(late.currentTarget.value, '0.5');
		assert.deepEqual(calls, ['begin', 'change:0.6', 'cancel']);
	});
});
