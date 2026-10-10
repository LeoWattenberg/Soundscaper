/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MixerFader } from '../vendor/audacity-design-system/components/src/MixerFader/MixerFader.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface Pointer {
	readonly pointerId: number;
	readonly pointerType: string;
	readonly button: number;
	readonly isPrimary: boolean;
	readonly clientY: number;
	preventDefault(): void;
}
interface Props {
	onPointerDown(event: Pointer): void;
	onPointerMove(event: Pointer): void;
	onPointerUp(event: Pointer): void;
	onPointerCancel(event: Pointer): void;
}
const pointer = (changes: Partial<Pointer> = {}): Pointer => ({
	pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true, clientY: 124, preventDefault() {}, ...changes,
});

async function mounted(check: (props: Props, calls: string[], captures: number[]) => void): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [], captures: number[] = [];
	try {
		await act(async () => root.render(<MixerFader value={0}
			onGestureStart={value => { calls.push(`start:${value}`); }}
			onChange={value => { calls.push(`preview:${value}`); }}
			onGestureEnd={value => { calls.push(`end:${value}`); }}
			onChangeEnd={value => { calls.push(`commit:${value}`); }}
			onGestureCancel={() => { calls.push('cancel'); }} />));
		const track = dom.one('.mixer-fader__track');
		Object.defineProperties(track, {
			getBoundingClientRect: { value: () => ({ top: 100, height: 144 }) },
			setPointerCapture: { value: (id: number) => { captures.push(id); } },
		});
		await act(async () => { check(reactProps(track) as unknown as Props, calls, captures); });
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
}

test('the actual Mixer fader keeps the admitted capture when another finger starts', async () => {
	await mounted((props, calls, captures) => {
		props.onPointerDown(pointer());
		let prevented = false;
		props.onPointerDown(pointer({ pointerId: 8, isPrimary: false, preventDefault() { prevented = true; } }));
		assert.equal(prevented, true);
		assert.deepEqual(captures, [7]);
		assert.deepEqual(calls, ['start:0', 'preview:0']);
	});
});

for (const event of ['onPointerMove', 'onPointerUp', 'onPointerCancel'] as const) {
	test(`the actual Mixer fader rejects foreign ${event} without ending its admitted edit`, async () => {
		await mounted((props, calls) => {
			props.onPointerDown(pointer());
			props.onPointerMove(pointer({ clientY: 156 }));
			props[event](pointer({ pointerId: 8, isPrimary: false, clientY: 220 }));
			assert.deepEqual(calls, ['start:0', 'preview:0', 'preview:-16']);
			props.onPointerMove(pointer({ clientY: 180 }));
			props.onPointerUp(pointer({ clientY: 180 }));
			assert.deepEqual(calls.slice(-3), ['preview:-28', 'end:-28', 'commit:-28']);
		});
	});
}

test('the actual Mixer fader retains ordinary owning completion, cancellation and later capture', async () => {
	await mounted((props, calls, captures) => {
		props.onPointerDown(pointer());
		props.onPointerMove(pointer({ clientY: 156 }));
		props.onPointerUp(pointer({ clientY: 156 }));
		props.onPointerUp(pointer({ clientY: 180 }));
		assert.deepEqual(calls, ['start:0', 'preview:0', 'preview:-16', 'end:-16', 'commit:-16']);
		props.onPointerDown(pointer({ pointerId: 9 }));
		props.onPointerCancel(pointer({ pointerId: 9 }));
		props.onPointerUp(pointer({ pointerId: 9 }));
		assert.deepEqual(calls.slice(-3), ['start:0', 'preview:0', 'cancel']);
		assert.deepEqual(captures, [7, 9]);
	});
});
