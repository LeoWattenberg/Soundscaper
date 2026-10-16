/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Slider } from '../vendor/audacity-design-system/components/src/Slider/Slider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Pointer {
	readonly pointerId: number;
	readonly button: number;
	readonly isPrimary: boolean;
	preventDefault(): void;
}
interface Props {
	onPointerDown(event: Pointer): void;
	onPointerUp(event: Pointer): void;
	onPointerCancel(event: Pointer): void;
	onChange(event: { target: { value: string } }): void;
	onKeyDown(event: { key: string }): void;
	onKeyUp(event: { key: string }): void;
	onBlur(): void;
}
const pointer = (pointerId: number, isPrimary = true): Pointer => ({ pointerId, button: 0, isPrimary, preventDefault() {} });

async function mounted(check: (props: Props, calls: string[]) => void): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	try {
		await act(async () => root.render(<Slider value={80}
			onGestureStart={value => { calls.push(`start:${value}`); }}
			onChange={value => { calls.push(`change:${value}`); }}
			onGestureEnd={value => { calls.push(`end:${value}`); }}
			onGestureCancel={() => { calls.push('cancel'); }} />));
		const props = reactProps(dom.one('input')) as unknown as Props;
		await act(async () => { check(props, calls); });
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

test('the actual vendor Volume slider prevents a second native pointer default', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer(4));
		props.onChange({ target: { value: '60' } });
		let prevented = false;
		props.onPointerDown({ ...pointer(5, false), preventDefault() { prevented = true; } });
		assert.equal(prevented, true);
		assert.deepEqual(calls, ['start:80', 'change:60']);
	});
});

for (const finish of ['onPointerUp', 'onPointerCancel'] as const) {
	test(`the vendor Volume slider retains its accepted pointer through a foreign ${finish}`, async () => {
		await mounted((props, calls) => {
			props.onPointerDown(pointer(4));
			props.onChange({ target: { value: '60' } });
			props[finish](pointer(5, false));
			assert.deepEqual(calls, ['start:80', 'change:60']);
			props.onChange({ target: { value: '40' } });
			props.onPointerUp(pointer(4));
			props.onPointerUp(pointer(4));
			assert.deepEqual(calls, ['start:80', 'change:60', 'change:40', 'end:40']);
		});
	});
}

test('the vendor Volume slider retains native primary, keyboard, blur and cancellation completion', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer(4));
		props.onChange({ target: { value: '60' } });
		props.onPointerUp(pointer(4));
		props.onKeyDown({ key: 'ArrowRight' });
		props.onChange({ target: { value: '81' } });
		props.onKeyUp({ key: 'ArrowRight' });
		props.onKeyDown({ key: 'ArrowLeft' });
		props.onChange({ target: { value: '79' } });
		props.onBlur();
		props.onPointerDown(pointer(7));
		props.onChange({ target: { value: '70' } });
		props.onPointerCancel(pointer(7));
		assert.deepEqual(calls, ['start:80', 'change:60', 'end:60', 'start:80', 'change:81', 'end:81',
			'start:80', 'change:79', 'end:79', 'start:80', 'change:70', 'cancel']);
	});
});
