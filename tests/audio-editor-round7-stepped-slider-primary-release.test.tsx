/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { SteppedSlider } from '../src/common/editor/ui/inspector/SteppedSlider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Pointer {
	readonly pointerId: number;
	readonly button: number;
	readonly buttons: number;
	readonly pointerType: string;
	readonly isPrimary: boolean;
	preventDefault(): void;
}
interface Props {
	onPointerDown(event: Pointer): void;
	onPointerMove?(event: Pointer): void;
	onPointerUp(event: Pointer): void;
	onLostPointerCapture?(event: Pointer): void;
	onChange(event: { currentTarget: { value: string } }): void;
	onKeyDown(event: { key: string; preventDefault(): void; stopPropagation(): void }): void;
}
const pointer = (pointerId = 7, buttons = 1, button = 0, pointerType = 'mouse'): Pointer => ({
	pointerId, buttons, button, pointerType, isPrimary: true, preventDefault() {},
});
async function mounted(run: (props: Props, calls: string[]) => void): Promise<void> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	try {
		await act(async () => { root.render(<SteppedSlider value={.5} min={0} max={1} step={.01}
			ariaLabel="Master gain" onChange={value => { calls.push(`change:${value}`); }}
			onGestureStart={() => { calls.push('begin'); }}
			onGestureEnd={value => { calls.push(`end:${value}`); }}
			onGestureCancel={() => { calls.push('cancel'); }} />); });
		const props = reactProps(dom.one('input')) as unknown as Props;
		await act(async () => { run(props, calls); });
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}

for (const buttons of [4, 0]) test(`the native range completes primary release with buttons=${buttons} and admits the next drag`, async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer());
		props.onChange({ currentTarget: { value: '.6' } });
		props.onPointerMove?.(pointer(7, buttons));
		assert.deepEqual(calls, ['begin', 'change:0.6', 'end:0.6']);
		props.onLostPointerCapture?.(pointer(7, buttons));
		props.onPointerUp(pointer(7, 0, 1));
		assert.deepEqual(calls, ['begin', 'change:0.6', 'end:0.6']);
		let prevented = false;
		props.onPointerDown({ ...pointer(9), preventDefault() { prevented = true; } });
		assert.equal(prevented, false);
		props.onChange({ currentTarget: { value: '.7' } });
		props.onPointerUp(pointer(9, 0));
		assert.deepEqual(calls, ['begin', 'change:0.6', 'end:0.6', 'begin', 'change:0.7', 'end:0.7']);
	});
});

test('unexpected owning capture loss cancels the range and releases its next pointer admission', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer());
		props.onChange({ currentTarget: { value: '.6' } });
		props.onLostPointerCapture?.(pointer());
		assert.deepEqual(calls, ['begin', 'change:0.6', 'cancel']);
		const late = { currentTarget: { value: '.8' } };
		props.onChange(late);
		assert.equal(late.currentTarget.value, '0.5');
		props.onPointerDown(pointer(9));
		props.onChange({ currentTarget: { value: '.7' } });
		props.onPointerUp(pointer(9, 0));
		assert.deepEqual(calls, ['begin', 'change:0.6', 'cancel', 'begin', 'change:0.7', 'end:0.7']);
	});
});

for (const variant of ['foreign-pointer', 'touch', 'held-primary'] as const) {
	test(`native range primary-release cleanup retains the healthy ${variant} gesture`, async () => {
		await mounted((props, calls) => {
			props.onPointerDown(pointer());
			props.onChange({ currentTarget: { value: '.6' } });
			props.onPointerMove?.(variant === 'foreign-pointer' ? pointer(8, 0)
				: variant === 'touch' ? pointer(7, 0, 0, 'touch') : pointer(7, 5, 1));
			if (variant === 'foreign-pointer') props.onLostPointerCapture?.(pointer(8));
			assert.deepEqual(calls, ['begin', 'change:0.6']);
			props.onChange({ currentTarget: { value: '.7' } });
			props.onPointerUp(pointer(7, 0));
			assert.deepEqual(calls, ['begin', 'change:0.6', 'change:0.7', 'end:0.7']);
		});
	});
}

test('Escape remains canceled through primary release and late input before a fresh keyboard edit', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer());
		props.onChange({ currentTarget: { value: '.6' } });
		props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
		props.onPointerMove?.(pointer(7, 4));
		props.onLostPointerCapture?.(pointer(7, 4));
		const late = { currentTarget: { value: '.8' } };
		props.onChange(late);
		assert.equal(late.currentTarget.value, '0.5');
		assert.deepEqual(calls, ['begin', 'change:0.6', 'cancel']);
		props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} });
		props.onChange({ currentTarget: { value: '.7' } });
		assert.deepEqual(calls, ['begin', 'change:0.6', 'cancel', 'begin', 'change:0.7']);
	});
});
