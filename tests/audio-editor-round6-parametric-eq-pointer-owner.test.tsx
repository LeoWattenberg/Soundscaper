/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ParametricEqEditor } from '../src/common/editor/ui/ParametricEqEditor.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

interface Band { readonly id: string; readonly enabled: boolean; readonly type: string;
	readonly gain: number; readonly frequency: number; readonly q: number; readonly slope: number }
interface Params { readonly outputGain: number; readonly bands: readonly Band[] }

async function withEditor(run: (fixture: { handle(index?: number): ReactTestElement;
	begin(index: number, id: number, isPrimary?: boolean): Promise<void>;
	move(index: number, id: number): Promise<void>;
	end(index: number, id: number): Promise<void>;
	readonly commits: Params[]; readonly cancellations: Params[]; readonly starts: Params[] }) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	const priorRect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
		value: () => ({ left: 0, top: 0, width: 640, height: 220 }) });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let params: Params = { outputGain: 0, bands: [
		{ id: 'low', enabled: true, type: 'peaking', frequency: 100, gain: 0, q: 1, slope: 12 },
		{ id: 'high', enabled: true, type: 'peaking', frequency: 500, gain: 0, q: 1, slope: 12 },
	] };
	const commits: Params[] = []; const cancellations: Params[] = []; const starts: Params[] = [];
	const render = (): void => root.render(<ParametricEqEditor params={params} effectId="eq"
		onPreview={undefined} onAudition={undefined} readSpectrum={undefined} parameterAutomation={undefined}
		onGestureBegin={(next: Params) => { starts.push(next); }}
		onCancel={(next: Params) => { params = next; cancellations.push(next); }}
		onCommit={(next: Params) => { params = next; commits.push(next); render(); }} />);
	const handle = (index = 0): ReactTestElement => dom.container.querySelectorAll('.audio-editor-parametric-eq__handle')[index]!;
	try {
		await act(async () => render());
		await run({ handle, commits, cancellations, starts,
			begin: async (index, id, isPrimary = true) => { await act(async () => reactProps(handle(index)).onPointerDown({
				button: 0, pointerId: id, isPrimary, clientX: 100, clientY: 100,
				preventDefault() {}, stopPropagation() {}, currentTarget: { setPointerCapture() {} },
			})); },
			move: async (index, id) => { await act(async () => reactProps(handle(index)).onPointerMove({
				pointerId: id, currentTarget: handle(index), clientX: 240, clientY: 60,
			})); },
			end: async (index, id) => { await act(async () => reactProps(handle(index)).onPointerUp({
				pointerId: id, currentTarget: { releasePointerCapture() {} },
			})); },
		});
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		for (const [target, key, descriptor] of [
			[globalThis, 'React', priorReact], [ReactTestElement.prototype, 'getContext', priorContext],
			[ReactTestElement.prototype, 'getBoundingClientRect', priorRect],
		] as const) {
			if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key);
		}
		dom.restore();
	}
}

test('one primary EQ drag commits once and retains the other band', async () => {
	await withEditor(async f => {
		await f.begin(0, 1); await f.move(0, 1); await f.end(0, 1);
		assert.equal(f.commits.length, 1); assert.equal(f.starts.length, 1);
		assert.equal(f.commits[0]!.bands[1]!.frequency, 500);
		assert.equal(f.commits[0]!.bands[1]!.gain, 0);
		assert.notEqual(f.commits[0]!.bands[0]!.frequency, 100);
	});
});

test('a second EQ touch cannot replace the primary drag', async () => {
	await withEditor(async f => {
		await f.begin(0, 1); await f.move(0, 1); await f.begin(1, 2, false);
		await f.move(0, 1); await f.end(0, 1);
		assert.equal(f.starts.length, 1); assert.equal(f.commits.length, 1);
		assert.equal(f.commits[0]!.bands[1]!.frequency, 500);
		assert.equal(f.commits[0]!.bands[1]!.gain, 0);
	});
});

test('another pointer moving over the active EQ handle cannot change its draft', async () => {
	await withEditor(async f => {
		await f.begin(0, 1); const before = f.handle().getAttribute('aria-label');
		await f.move(0, 2);
		assert.equal(f.handle().getAttribute('aria-label'), before);
		await f.move(0, 1); await f.end(0, 1); assert.equal(f.commits.length, 1);
	});
});

test('another EQ pointer release cannot finish the active drag', async () => {
	await withEditor(async f => {
		await f.begin(0, 1); await f.move(0, 1); await f.end(1, 2);
		assert.equal(f.commits.length, 0);
		await f.move(0, 1); await f.end(0, 1); assert.equal(f.commits.length, 1);
	});
});

test('another EQ pointer cancellation cannot cancel the primary draft', async () => {
	await withEditor(async f => {
		await f.begin(0, 1); await f.move(0, 1);
		await act(async () => reactProps(f.handle(1)).onPointerCancel({ pointerId: 2 }));
		assert.equal(f.cancellations.length, 0);
		await f.end(0, 1); assert.equal(f.commits.length, 1);
	});
});

test('loss of the owning EQ capture restores the draft and does not commit', async () => {
	await withEditor(async f => {
		const before = f.handle().getAttribute('aria-label');
		await f.begin(0, 1); await f.move(0, 1);
		await act(async () => reactProps(f.handle()).onLostPointerCapture?.({ pointerId: 1 }));
		assert.equal(f.handle().getAttribute('aria-label'), before);
		assert.equal(f.cancellations.length, 1); await f.end(0, 1); assert.equal(f.commits.length, 0);
	});
});
