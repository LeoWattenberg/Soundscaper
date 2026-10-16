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
	readonly buttons: number;
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
	pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true,
	clientY: 124, preventDefault() {}, ...changes,
});

async function mounted(check: (props: Props, calls: string[], released: number[]) => void): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [], released: number[] = [];
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
			setPointerCapture: { value: () => {} },
			hasPointerCapture: { value: () => true },
			releasePointerCapture: { value: (id: number) => { released.push(id); } },
		});
		await act(async () => { check(reactProps(track) as unknown as Props, calls, released); });
	} finally {
		await act(async () => { root.unmount(); });
		globals.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
}

for (const buttons of [4, 2]) test(`MixerFader commits the owning primary release with buttons ${buttons} remaining`, async () => {
	await mounted((props, calls, released) => {
		props.onPointerDown(pointer());
		props.onPointerMove(pointer({ clientY: 156 }));
		assert.deepEqual(calls, ['start:0', 'preview:0', 'preview:-16']);
		props.onPointerMove(pointer({ clientY: 156, buttons }));
		assert.deepEqual(calls.slice(-2), ['end:-16', 'commit:-16']);
		assert.deepEqual(released, [7]);
		const completed = [...calls];
		props.onPointerMove(pointer({ clientY: 180, buttons, button: -1 }));
		props.onPointerUp(pointer({ clientY: 180, buttons: 0, button: buttons === 4 ? 1 : 2 }));
		assert.deepEqual(calls, completed);
		props.onPointerDown(pointer({ pointerId: 9 }));
		props.onPointerMove(pointer({ pointerId: 9, clientY: 140 }));
		props.onPointerUp(pointer({ pointerId: 9, clientY: 140, buttons: 0 }));
		assert.deepEqual(calls.slice(-2), ['end:-8', 'commit:-8']);
	});
});

for (const phase of ['foreign', 'touch', 'pen', 'auxiliary'] as const)
	test(`MixerFader preserves ${phase} motion without prematurely completing the owning gesture`, async () => {
		await mounted((props, calls) => {
			const contact = phase === 'touch' || phase === 'pen' ? { pointerType: phase } : {};
			props.onPointerDown(pointer(contact));
			props.onPointerMove(pointer({ ...contact, clientY: 156 }));
			props.onPointerMove(pointer({ ...contact, clientY: 156,
				pointerId: phase === 'foreign' ? 8 : 7,
				button: phase === 'auxiliary' ? 1 : 0, buttons: phase === 'auxiliary' ? 1 : 4 }));
			assert.equal(calls.some(call => call.startsWith('end:')), false);
			props.onPointerUp(pointer({ ...contact, clientY: 156, buttons: 0 }));
			assert.deepEqual(calls.slice(-2), ['end:-16', 'commit:-16']);
		});
	});

test('MixerFader commits the final native primary-release coordinates', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer());
		props.onPointerMove(pointer({ clientY: 156 }));
		props.onPointerMove(pointer({ clientY: 140, buttons: 4 }));
		assert.deepEqual(calls.slice(-2), ['end:-8', 'commit:-8']);
	});
});

test('MixerFader preserves owning cancellation without a late primary-release commit', async () => {
	await mounted((props, calls) => {
		props.onPointerDown(pointer());
		props.onPointerMove(pointer({ clientY: 156 }));
		props.onPointerCancel(pointer());
		const cancelled = [...calls];
		assert.equal(cancelled.at(-1), 'cancel');
		props.onPointerMove(pointer({ clientY: 180, buttons: 4 }));
		props.onPointerUp(pointer({ clientY: 180, buttons: 0 }));
		assert.deepEqual(calls, cancelled);
	});
});
