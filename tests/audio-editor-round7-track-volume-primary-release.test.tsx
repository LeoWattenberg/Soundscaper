/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Slider } from '../vendor/audacity-design-system/components/src/Slider/Slider.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Pointer {
	readonly pointerId: number;
	readonly pointerType: string;
	readonly button: number;
	readonly buttons: number;
	readonly isPrimary: boolean;
	preventDefault(): void;
}
interface Props {
	onPointerDown(event: Pointer): void;
	onPointerMove?: (event: Pointer) => void;
	onPointerUp(event: Pointer): void;
	onPointerCancel(event: Pointer): void;
	onChange(event: { target: { value: string } }): void;
}
const pointer = (changes: Partial<Pointer> = {}): Pointer => ({
	pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true, preventDefault() {}, ...changes,
});

async function mounted(check: (props: Props, calls: string[]) => void): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	try {
		await act(async () => root.render(<Slider value={75}
			onGestureStart={value => { calls.push(`start:${value}`); }}
			onChange={value => { calls.push(`preview:${value}`); }}
			onGestureEnd={value => { calls.push(`commit:${value}`); }}
			onGestureCancel={() => { calls.push('cancel'); }} />));
		await act(async () => { check(reactProps(dom.one('input')) as unknown as Props, calls); });
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
}

for (const buttons of [4, 2]) test(`the actual Volume slider publishes primary release with buttons ${buttons} still held`, async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer());
		props.onChange({ target: { value: '38' } });
		assert.deepEqual(calls, ['start:75', 'preview:38']);
		props.onPointerMove?.(pointer({ buttons }));
		assert.deepEqual(calls, ['start:75', 'preview:38', 'commit:38']);
		props.onPointerMove?.(pointer({ button: -1, buttons }));
		props.onPointerUp(pointer({ button: buttons === 4 ? 1 : 2, buttons: 0 }));
		assert.deepEqual(calls, ['start:75', 'preview:38', 'commit:38']);
		props.onPointerDown(pointer());
		props.onChange({ target: { value: '60' } });
		props.onPointerUp(pointer({ buttons: 0 }));
		assert.deepEqual(calls.slice(-3), ['start:75', 'preview:60', 'commit:60']);
	});
});

test('Volume retains its own primary preview through foreign, touch and auxiliary release transitions', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer());
		props.onChange({ target: { value: '38' } });
		props.onPointerMove?.(pointer({ pointerId: 8, buttons: 4 }));
		props.onPointerMove?.(pointer({ pointerType: 'touch', buttons: 4 }));
		props.onPointerMove?.(pointer({ button: 1, buttons: 1 }));
		props.onPointerMove?.(pointer({ button: -1, buttons: 4 }));
		assert.deepEqual(calls, ['start:75', 'preview:38']);
		props.onPointerUp(pointer({ buttons: 0 }));
		assert.deepEqual(calls, ['start:75', 'preview:38', 'commit:38']);
	});
});

test('Volume preserves browser cancellation without publishing a later mouse release', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer());
		props.onChange({ target: { value: '38' } });
		props.onPointerCancel(pointer());
		props.onPointerMove?.(pointer({ buttons: 4 }));
		props.onPointerUp(pointer({ button: 1, buttons: 0 }));
		assert.deepEqual(calls, ['start:75', 'preview:38', 'cancel']);
	});
});
