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

for (const terminal of ['outside-up', 'outside-primary', 'outside-cancel', 'unmount']) {
	test(`native video mouse custody retains own ${terminal} without capturing its thumb`, async () => {
		const dom = installReactTestDom();
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
		const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		const listeners = new Map<string, Set<EventListener>>();
		Reflect.set(document, 'addEventListener', (kind: string, listener: EventListener) => {
			const registered = listeners.get(kind) ?? new Set<EventListener>();
			registered.add(listener); listeners.set(kind, registered);
		});
		Reflect.set(document, 'removeEventListener', (kind: string, listener: EventListener) => {
			listeners.get(kind)?.delete(listener);
		});
		const emit = async (kind: string, pointerId: number, button = 0, buttons = 0): Promise<void> => {
			const event = Object.assign(new Event(kind), { pointerId, pointerType: 'mouse', button, buttons });
			await act(async () => { for (const listener of [...listeners.get(kind) ?? []]) listener(event); });
		};
		const registered = (): number => [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0);
		const seeded = createVideoEffect('color-adjust', { id: 'color' });
		let effect: VideoEffectLeaf & Readonly<{ params: Readonly<Record<string, number>> & { brightness: number } }>
			= { ...seeded, params: { ...seeded.params, brightness: 0 } };
		const committed: number[] = [];
		let original = 0, canceled = 0, captures = 0, unmounted = false;
		const actions = {
			beginGesture() { original = effect.params.brightness; },
			preview(_clip: string, _effect: string, values: Readonly<Record<string, number>>) {
				effect = { ...effect, params: { ...effect.params, ...values } }; render();
			},
			commit() { committed.push(effect.params.brightness); },
			cancel() { canceled++; effect = { ...effect, params: { ...effect.params, brightness: original } }; },
		};
		const render = (): void => root.render(<VideoEffectRack clip={{ id: 'clip', videoEffects: [effect] }}
			controller={{ actions: { video: { effects: actions } } }} copy={ENGLISH_COPY}
			disabled={false} onError={(message: string) => { assert.equal(message, ''); }} />);
		try {
			await act(async () => { render(); });
			const range = dom.one('[data-video-effect-param="brightness"]').querySelectorAll('input').find(input => input.type === 'range');
			assert.ok(range);
			const down = async (pointerId: number): Promise<void> => {
				await act(async () => { reactProps(range).onPointerDown?.({ pointerId, pointerType: 'mouse', button: 0,
					isPrimary: true, currentTarget: { ownerDocument: document, setPointerCapture() { captures++; } } }); });
			};
			const change = async (value: number): Promise<void> => {
				await act(async () => { reactProps(range).onChange?.({ currentTarget: { value: String(value) } }); });
			};
			await down(7);
			assert.equal(captures, 0, 'explicit DOM capture cannot steal the native mouse thumb');
			assert.equal(registered(), 3, 'terminal authority survives an outside native hit');
			await change(.53);
			await emit('pointerup', 8);
			await emit('pointercancel', 8);
			assert.equal(registered(), 3);
			assert.deepEqual(committed, []);
			assert.equal(canceled, 0);
			if (terminal === 'unmount') {
				await act(async () => { root.unmount(); }); unmounted = true;
			} else if (terminal === 'outside-cancel') await emit('pointercancel', 7);
			else if (terminal === 'outside-primary') {
				await emit('pointermove', 7, -1, 4);
				assert.deepEqual(committed, [], 'only the actual primary-button transition ends this range');
				await emit('pointermove', 7, 0, 4);
			} else await emit('pointerup', 7);
			assert.equal(registered(), 0);
			assert.deepEqual(committed, terminal === 'outside-cancel' || terminal === 'unmount' ? [] : [.53]);
			assert.equal(canceled, terminal === 'outside-cancel' || terminal === 'unmount' ? 1 : 0);
			await emit('pointerup', 7);
			if (!unmounted) {
				await down(9); await change(.21); await emit('pointerup', 9);
				assert.equal(committed.at(-1), .21);
				assert.equal(registered(), 0);
			}
		} finally {
			if (!unmounted) await act(async () => { root.unmount(); });
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
			else Reflect.deleteProperty(globalThis, 'React');
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		}
	});
}
