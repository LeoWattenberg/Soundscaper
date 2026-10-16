/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ParametricEqEditor } from '../src/common/editor/ui/ParametricEqEditor.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

interface Band { readonly id: string; readonly enabled: boolean; readonly type: string;
	readonly gain: number; readonly frequency: number; readonly q: number; readonly slope: number }
interface Params { readonly outputGain: number; readonly bands: readonly Band[] }
type Kind = 'band' | 'output';
interface Fixture {
	send(handler: string, event?: Readonly<Record<string, unknown>>): Promise<void>;
	readonly commits: Params[];
	readonly cancellations: Params[];
	value(): number;
}

for (const kind of ['band', 'output'] as const) test(`Parametric ${kind} completes one owning primary-release transition before capture loss`, async () => {
	await withEditor(kind, async f => {
		await begin(f);
		await update(f, kind);
		const accepted = f.value();
		assert.ok(accepted > 0);
		await f.send('onPointerMove', { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 4,
			clientX: 240, clientY: 60 });
		assert.equal(f.commits.length, 1, 'Primary completion must commit before native capture retirement.');
		assert.equal(committedValue(f.commits[0]!, kind), kind === 'band' ? 24 - 60 / 220 * 48 : accepted);
		await f.send('onLostPointerCapture', { pointerId: 1 });
		assert.equal(f.cancellations.length, 0);
		await f.send('onPointerMove', { pointerType: 'mouse', pointerId: 1, button: -1, buttons: 4,
			clientX: 300, clientY: 160 });
		await f.send('onPointerUp', { pointerId: 1 });
		assert.equal(f.commits.length, 1);
		assert.equal(f.value(), accepted, 'Later auxiliary motion cannot replace the completed primary value.');
		await begin(f, 2);
		await update(f, kind, 2);
		await f.send('onPointerUp', { pointerId: 2 });
		assert.equal(f.commits.length, 2, 'A later ordinary gesture remains usable.');
	});
});

test('Parametric modifier-Q completion retains its final accepted value', async () => {
	await withEditor('band', async f => {
		await begin(f);
		await f.send('onPointerMove', { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 4,
			clientX: 100, clientY: 40, ctrlKey: true });
		assert.equal(f.commits.length, 1);
		assert.equal(f.commits[0]!.bands[0]!.q, 2 ** .25);
		await f.send('onLostPointerCapture', { pointerId: 1 });
		assert.equal(f.cancellations.length, 0);
	});
});

for (const kind of ['band', 'output'] as const) for (const control of ['held-primary', 'native-touch', 'foreign-pointer', 'own-cancel'] as const) {
	test(`Parametric ${kind} preserves ${control} admission`, async () => {
		await withEditor(kind, async f => {
			await begin(f);
			await update(f, kind);
			if (control === 'own-cancel') {
				await f.send('onLostPointerCapture', { pointerId: 1 });
				assert.equal(f.cancellations.length, 1);
				assert.equal(f.value(), 0);
				await f.send('onPointerUp', { pointerId: 1 });
				assert.equal(f.commits.length, 0);
				return;
			}
			await f.send('onPointerMove', { pointerType: control === 'native-touch' ? 'touch' : 'mouse',
				pointerId: control === 'foreign-pointer' ? 2 : 1, button: 0,
				buttons: control === 'held-primary' ? 5 : 0, clientX: 240, clientY: 60 });
			assert.equal(f.commits.length, 0);
			assert.equal(f.cancellations.length, 0);
			await f.send('onPointerUp', { pointerId: 1 });
			assert.equal(f.commits.length, 1);
		});
	});
}

async function begin(f: Fixture, pointerId = 1): Promise<void> {
	await f.send('onPointerDown', { pointerType: 'mouse', pointerId, button: 0, buttons: 1,
		isPrimary: true, clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} });
}

async function update(f: Fixture, kind: Kind, pointerId = 1): Promise<void> {
	await f.send(kind === 'band' ? 'onPointerMove' : 'onChange', kind === 'band'
		? { pointerType: 'mouse', pointerId, buttons: 1, clientX: 240, clientY: 60 }
		: { currentTarget: { value: '4' } });
}

function committedValue(params: Params, kind: Kind): number {
	return kind === 'band' ? params.bands[0]!.gain : params.outputGain;
}

async function withEditor(kind: Kind, run: (f: Fixture) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const saved = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({ React, IS_REACT_ACT_ENVIRONMENT: true })) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const context = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	const rect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
		value: () => ({ left: 0, top: 0, width: 640, height: 220 }) });
	let params: Params = { outputGain: 0, bands: [{ id: 'band', enabled: true, type: 'peaking', frequency: 100,
		gain: 0, q: 1, slope: 12 }] };
	const commits: Params[] = [], cancellations: Params[] = [];
	let retiring = false;
	const render = (): void => root.render(<ParametricEqEditor params={params} effectId="eq"
		onGestureBegin={() => undefined} onPreview={undefined} onAudition={undefined} readSpectrum={undefined}
		parameterAutomation={undefined} onCommit={(next: Params) => { params = next; commits.push(next); render(); }}
		onCancel={(next: Params) => { params = next; cancellations.push(next); if (!retiring) render(); }} />);
	const owner = (): ReactTestElement => {
		if (kind === 'band') return dom.one('.audio-editor-parametric-eq__handle');
		const range = dom.one('.audio-editor-parametric-eq__output').querySelectorAll('input').find(input => input.type === 'range');
		assert.ok(range); return range;
	};
	try {
		await act(async () => render());
		await run({ commits, cancellations, value: () => kind === 'band'
			? Number(owner().getAttribute('aria-label')?.match(/, (-?[\d.]+) dB,/u)?.[1]) : Number(owner().value),
			send: async (handler, event = {}) => {
				const node = owner();
				await act(async () => reactProps(node)[handler]?.({ currentTarget: node, ...event }));
			} });
	} finally {
		retiring = true;
		await act(async () => root.unmount());
		for (const [key, descriptor] of saved) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
		}
		for (const [key, descriptor] of [['getContext', context], ['getBoundingClientRect', rect]] as const) {
			if (descriptor) Object.defineProperty(ReactTestElement.prototype, key, descriptor);
			else Reflect.deleteProperty(ReactTestElement.prototype, key);
		}
		dom.restore();
	}
}
