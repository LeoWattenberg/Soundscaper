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

for (const variant of ['secondary-down', 'foreign-up', 'foreign-cancel']) test(`video range owns its primary gesture through ${variant}`, async () => {
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
	const captures: number[] = [];
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
		await act(async () => { reactProps(input).onPointerDown?.({ pointerId: 1, button: 0, isPrimary: true,
			currentTarget: { setPointerCapture(id: number) { captures.push(id); } } }); });
		await change(0.2);
		assert.equal(effect.params.brightness, 0.2);
		if (variant === 'secondary-down') {
			let consumed = false;
			await act(async () => { reactProps(input).onPointerDown?.({ pointerId: 2, button: 0, isPrimary: false,
				preventDefault() { consumed = true; },
				currentTarget: { setPointerCapture(id: number) { captures.push(id); } } }); });
			assert.equal(consumed, true, 'a secondary finger must not take over the native range drag');
		} else await act(async () => { reactProps(input)[variant === 'foreign-up' ? 'onPointerUp' : 'onPointerCancel']?.({ pointerId: 2 }); });
		assert.deepEqual(captures, [1]);
		assert.deepEqual(committed, [], 'a foreign pointer cannot publish the primary preview');
		assert.equal(effect.params.brightness, 0.2, 'a foreign pointer cannot cancel the primary preview');
		await change(0.5);
		await act(async () => { reactProps(input).onPointerUp?.({ pointerId: 1 }); });
		assert.deepEqual(committed, [0.5]);
		await act(async () => { reactProps(input).onPointerDown?.({ pointerId: 3, button: 0, isPrimary: true,
			currentTarget: { setPointerCapture(id: number) { captures.push(id); } } }); });
		await change(0.8);
		await act(async () => { reactProps(input).onPointerCancel?.({ pointerId: 3 }); });
		assert.equal(effect.params.brightness, 0.5);
		assert.deepEqual(committed, [0.5]);
		assert.deepEqual(errors, []);
	} finally {
		await act(async () => { root.unmount(); });
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore(); actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
