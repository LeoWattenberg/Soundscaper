/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import VideoEffectRack from '../src/common/editor/ui/inspector/VideoEffectRack.jsx';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { VideoEffectLeaf } from '../src/common/editor/project-media-types.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function mounted(check: (move: (event: Readonly<Record<string, unknown>>) => Promise<void>,
	change: (value: number) => Promise<void>, up: () => Promise<void>, calls: number[]) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const calls: number[] = [];
	const seeded = createVideoEffect('color-adjust', { id: 'color' });
	let effect: VideoEffectLeaf & Readonly<{ params: Readonly<Record<string, number>> & { brightness: number } }>
		= { ...seeded, params: { ...seeded.params, brightness: 0 } };
	const actions = {
		beginGesture() {},
		preview(_clip: string, _effect: string, changes: Readonly<Record<string, number>>) {
			effect = { ...effect, params: { ...effect.params, ...changes } }; render();
		},
		commit() { calls.push(effect.params.brightness); },
		cancel() {},
	};
	const render = (): void => root.render(<VideoEffectRack clip={{ id: 'clip', videoEffects: [effect] }}
		controller={{ actions: { video: { effects: actions } } }} copy={ENGLISH_COPY}
		disabled={false} onError={(message: string) => { assert.equal(message, ''); }} />);
	try {
		await act(async () => { render(); });
		const range = dom.one('[data-video-effect-param="brightness"]').querySelectorAll('input').find(node => node.type === 'range');
		assert.ok(range);
		await act(async () => { reactProps(range).onPointerDown?.({ pointerId: 7, button: 0, isPrimary: true,
			currentTarget: { setPointerCapture() {} } }); });
		const change = async (value: number): Promise<void> => {
			await act(async () => { reactProps(range).onChange?.({ currentTarget: { value: String(value) } }); });
		};
		const move = async (event: Readonly<Record<string, unknown>>): Promise<void> => {
			await act(async () => { reactProps(range).onPointerMove?.(event); });
		};
		const up = async (): Promise<void> => {
			await act(async () => { reactProps(range).onPointerUp?.({ pointerId: 7 }); });
		};
		await check(move, change, up, calls);
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
		dom.restore();
	}
}

for (const buttons of [4, 2]) test(`the actual video range publishes primary release while buttons ${buttons} remain`, async () => {
	await mounted(async (move, change, up, calls) => {
		await change(.53);
		assert.deepEqual(calls, []);
		await move({ pointerId: 7, pointerType: 'mouse', button: 0, buttons });
		assert.deepEqual(calls, [.53]);
		await move({ pointerId: 7, pointerType: 'mouse', button: -1, buttons });
		await up();
		assert.deepEqual(calls, [.53]);
	});
});

test('video range keeps owning preview through foreign, touch and auxiliary mouse transitions', async () => {
	await mounted(async (move, change, up, calls) => {
		await change(.21);
		await move({ pointerId: 8, pointerType: 'mouse', button: 0, buttons: 4 });
		await move({ pointerId: 7, pointerType: 'touch', button: 0, buttons: 4 });
		await move({ pointerId: 7, pointerType: 'mouse', button: 1, buttons: 1 });
		await move({ pointerId: 7, pointerType: 'mouse', button: -1, buttons: 4 });
		assert.deepEqual(calls, []);
		await change(.53);
		await up();
		assert.deepEqual(calls, [.53]);
	});
});
