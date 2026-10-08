/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ParametricEqEditor } from '../src/common/editor/ui/ParametricEqEditor.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

interface Band {
	readonly id: string; readonly enabled: boolean; readonly type: string;
	readonly gain: number; readonly frequency: number; readonly q: number; readonly slope: number;
}
interface Parameters { readonly outputGain: number; readonly bands: readonly Band[] }

async function withEditor(run: (dom: ReturnType<typeof installReactTestDom>, read: () => Parameters,
	commits: Parameters[]) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true, value: () => null });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let params: Parameters = { outputGain: 0, bands: [
		{ id: 'low', enabled: true, type: 'peaking', frequency: 100, gain: 0, q: 1, slope: 12 },
		{ id: 'high', enabled: true, type: 'peaking', frequency: 1_000, gain: 0, q: 1, slope: 12 },
	] };
	const commits: Parameters[] = [];
	const render = () => root.render(<ParametricEqEditor params={params} effectId="eq"
		onGestureBegin={undefined} onPreview={undefined} onCancel={undefined}
		onAudition={undefined} readSpectrum={undefined} parameterAutomation={undefined}
		onCommit={(next: Parameters) => { params = next; commits.push(next); render(); }} />);
	try {
		await act(async () => render());
		await run(dom, () => params, commits);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		if (priorContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', priorContext);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		dom.restore();
	}
}

for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'defaultPrevented']) {
	test(`parametric EQ leaves ${modifier} band commands to their owner`, async () => {
		await withEditor(async (dom, read, commits) => {
			const before = read();
			const handle = dom.one('.audio-editor-parametric-eq__handle');
			let prevented = false;
			let stopped = false;
			for (const key of ['ArrowUp', 'ArrowRight', 'Delete', 'Backspace']) {
				await act(async () => reactProps(handle).onKeyDown({ key, currentTarget: handle,
					[modifier]: true, shiftKey: false,
					preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } }));
				assert.equal(read(), before);
			}
			assert.equal(commits.length, 0);
			assert.equal(prevented, false);
			assert.equal(stopped, false);
		});
	});
}

test('plain and Shift parametric EQ arrows retain exact editing and keyboard deletion', async () => {
	await withEditor(async (dom, read, commits) => {
		const handle = () => dom.one('.audio-editor-parametric-eq__handle');
		for (const [key, shiftKey] of [['ArrowUp', false], ['ArrowUp', true]] as const) {
			await act(async () => reactProps(handle()).onKeyDown({ key, currentTarget: handle(), shiftKey,
				preventDefault() {}, stopPropagation() {} }));
		}
		assert.equal(read().bands[0]!.gain, 1.1);
		await act(async () => reactProps(handle()).onKeyDown({ key: 'ArrowRight', currentTarget: handle(),
			shiftKey: false, preventDefault() {}, stopPropagation() {} }));
		assert.ok(Math.abs(read().bands[0]!.frequency - 100 * 2 ** (1 / 12)) < 1e-9);
		await act(async () => reactProps(handle()).onKeyDown({ key: 'Delete', currentTarget: handle(),
			preventDefault() {}, stopPropagation() {} }));
		assert.deepEqual(read().bands.map(band => band.id), ['high']);
		assert.equal(commits.length, 4);
	});
});
