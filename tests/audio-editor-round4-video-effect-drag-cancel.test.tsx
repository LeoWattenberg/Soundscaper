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

test('mounted video ranges retain Escape cancellation until release, then permit a new edit', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const seeded = createVideoEffect('color-adjust', { id: 'color' });
	let effect: VideoEffectLeaf & Readonly<{ params: Readonly<Record<string, number>> & Readonly<{ brightness: number }> }>
		= { ...seeded, params: { ...seeded.params, brightness: 0 } };
	let original = 0;
	const committed: number[] = [];
	const errors: string[] = [];
	const render = (): void => { root.render(<VideoEffectRack clip={{ id: 'clip', videoEffects: [effect] }}
		controller={{ actions: { video: { effects: actions } } }} copy={ENGLISH_COPY} disabled={false}
		onError={(error: string) => { if (error) errors.push(error); }} />); };
	const actions = {
		beginGesture() { original = effect.params.brightness; },
		preview(_clipId: string, _effectId: string, params: Readonly<Record<string, number>>) {
			effect = { ...effect, params: { ...effect.params, ...params } }; render();
		},
		cancel() { effect = { ...effect, params: { ...effect.params, brightness: original } }; render(); },
		commit() { committed.push(effect.params.brightness); },
	};
	try {
		await act(async () => { render(); });
		const input = dom.one('[data-video-effect-param="brightness"]').querySelectorAll('input').find(control => control.type === 'range');
		assert.ok(input);
		const change = async (value: number): Promise<void> => {
			await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: String(value) } }); });
		};
		await act(async () => { reactProps(input).onPointerDown?.({ pointerId: 1, button: 0,
			currentTarget: { setPointerCapture() {} } }); });
		await change(0.4);
		assert.equal(effect.params.brightness, 0.4);
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); });
		assert.equal(effect.params.brightness, 0);
		await change(0.8);
		await act(async () => { reactProps(input).onPointerUp?.({ pointerId: 1 }); });
		await change(0.8);
		assert.equal(effect.params.brightness, 0);
		assert.deepEqual(committed, []);
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'ArrowRight' }); });
		await change(0.01);
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter' }); });
		assert.deepEqual(committed, [0.01]);
		assert.deepEqual(errors, []);
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
