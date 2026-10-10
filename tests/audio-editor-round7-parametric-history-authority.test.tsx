/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ParametricEqEditor } from '../src/common/editor/ui/ParametricEqEditor.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

interface Band { id: string; enabled: boolean; type: string; gain: number; frequency: number; q: number; slope: number }
interface Params { outputGain: number; bands: Band[] }
type Kind = 'band' | 'output';
interface Fixture {
	send(handler: string, event?: Readonly<Record<string, unknown>>): Promise<void>;
	author(value: number): Promise<void>;
	echo(): Promise<void>;
	flush(): Promise<void>;
	readonly commits: Params[];
	readonly cancellations: Params[];
	value(): number;
	previewCount(): number;
}

for (const kind of ['band', 'output'] as const) {
	test(`Parametric ${kind} retires its held draft when authored history changes`, async () => {
		await withEditor(kind, async f => {
			await begin(f); await update(f, kind);
			assert.ok(f.value() > 4);
			await f.author(0);
			assert.equal(f.value(), 0, 'Authored Undo must replace the held presentation.');
			assert.equal(f.cancellations.length, 1);
			await f.flush();
			assert.equal(f.previewCount(), 0, 'Queued obsolete preview must be retired.');
			await f.send('onPointerUp', { pointerId: 1 });
			await f.send('onLostPointerCapture', { pointerId: 1 });
			assert.equal(f.commits.length, 0);
			assert.equal(f.value(), 0);
			await begin(f, 2); await update(f, kind, 2);
			await f.send('onPointerUp', { pointerId: 2 });
			assert.equal(f.commits.length, 1);
			assert.ok(valueOf(f.commits[0]!, kind) > 0);
		});
	});
	for (const echo of [false, true]) test(`Parametric ${kind} retains ${echo ? 'acknowledged preview' : 'unchanged authored snapshot'}`, async () => {
		await withEditor(kind, async f => {
			await begin(f); await update(f, kind);
			const preview = f.value();
			if (echo) { await f.flush(); await f.echo(); } else await f.author(4);
			assert.equal(f.value(), preview);
			await f.send('onPointerUp', { pointerId: 1 });
			assert.equal(f.cancellations.length, 0);
			assert.equal(valueOf(f.commits[0]!, kind), preview);
		});
	});
}

async function begin(f: Fixture, pointerId = 1): Promise<void> {
	await f.send('onPointerDown', { pointerId, button: 0, buttons: 1, isPrimary: true,
		pointerType: 'mouse', clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {} });
}
async function update(f: Fixture, kind: Kind, pointerId = 1): Promise<void> {
	await f.send(kind === 'band' ? 'onPointerMove' : 'onChange', kind === 'band'
		? { pointerId, buttons: 1, pointerType: 'mouse', clientX: 100, clientY: 60 }
		: { currentTarget: { value: '8' } });
}
function valueOf(params: Params, kind: Kind): number {
	return kind === 'band' ? Math.round(params.bands[0]!.gain * 10) / 10 : params.outputGain;
}
async function withEditor(kind: Kind, run: (f: Fixture) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const saved = new Map<string, PropertyDescriptor | undefined>();
	const frames = new Map<number, FrameRequestCallback>();
	let frameId = 0, previews = 0, retiring = false;
	let previewParams: Params | null = null;
	for (const [key, value] of Object.entries({ React, IS_REACT_ACT_ENVIRONMENT: true,
		requestAnimationFrame: (callback: FrameRequestCallback): number => { frames.set(++frameId, callback); return frameId; },
		cancelAnimationFrame: (id: number): void => { frames.delete(id); },
	})) {
		saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	const context = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	const rect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
		value: () => ({ left: 0, top: 0, width: 640, height: 220 }) });
	let params: Params = { outputGain: 4, bands: [{ id: 'band', enabled: true, type: 'peaking', frequency: 100,
		gain: 4, q: 1, slope: 12 }] };
	const commits: Params[] = [], cancellations: Params[] = [];
	const render = (): void => root.render(<ParametricEqEditor params={params} effectId="eq"
		onGestureBegin={() => undefined} onPreview={(next: Params) => { previews += 1; previewParams = next; }} onAudition={undefined}
		readSpectrum={undefined} parameterAutomation={undefined}
		onCommit={(next: Params) => { commits.push(next); params = next; render(); }}
		onCancel={(next: Params) => { if (!retiring) cancellations.push(next); }} />);
	const owner = (): ReactTestElement => {
		if (kind === 'band') return dom.one('.audio-editor-parametric-eq__handle');
		const input = dom.one('.audio-editor-parametric-eq__output').querySelectorAll('input').find(input => input.type === 'range');
		assert.ok(input); return input;
	};
	try {
		await act(async () => render());
		await run({ commits, cancellations, value: () => kind === 'band'
			? Number(owner().getAttribute('aria-label')?.match(/, (-?[\d.]+) dB,/u)?.[1]) : Number(owner().value),
			previewCount: () => previews, flush: async () => { await act(async () => {
				const pending = [...frames.values()]; frames.clear(); for (const frame of pending) frame(0);
			}); },
			echo: async () => { assert.ok(previewParams); params = structuredClone(previewParams); await act(async () => render()); },
			author: async value => { params = kind === 'band' ? { ...params, bands: params.bands.map(band => ({ ...band, gain: value })) }
				: { ...params, outputGain: value }; await act(async () => render()); },
			send: async (handler, event = {}) => {
				const node = owner(); await act(async () => reactProps(node)[handler]?.({ currentTarget: node, ...event }));
			} });
	} finally {
		retiring = true; await act(async () => root.unmount());
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
