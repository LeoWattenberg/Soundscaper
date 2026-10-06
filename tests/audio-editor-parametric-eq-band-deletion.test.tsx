/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ParametricEqEditor } from '../src/common/editor/ui/ParametricEqEditor.jsx';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('parametric band deletion restores a surviving handle and finally its graph', async () => {
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
	let params: Record<string, unknown> = { outputGain: 0, bands: [
		{ id: 'low', enabled: true, type: 'peaking', frequency: 100, gain: 0, q: 1, slope: 12 },
		{ id: 'high', enabled: true, type: 'peaking', frequency: 1_000, gain: 0, q: 1, slope: 12 },
	] };
	const render = () => root.render(<ParametricEqEditor params={params} effectId="eq"
		onGestureBegin={undefined} onPreview={undefined} onCancel={undefined}
		onAudition={undefined} readSpectrum={undefined} parameterAutomation={undefined}
		onCommit={(next: Record<string, unknown>) => { params = next; render(); }} />);
	try {
		await act(async () => render());
		const last = dom.container.querySelectorAll('.audio-editor-parametric-eq__handle').at(-1)!;
		last.focus();
		await act(async () => reactProps(last).onKeyDown({
			key: 'Delete', currentTarget: last, preventDefault() {}, stopPropagation() {},
		}));
		const remaining = dom.one('.audio-editor-parametric-eq__handle');
		assert.equal(globalThis.document.activeElement, remaining);
		assert.equal(remaining.getAttribute('aria-pressed'), 'true');
		await act(async () => reactProps(remaining).onKeyDown({
			key: 'ArrowUp', currentTarget: remaining, shiftKey: false, preventDefault() {},
		}));
		assert.match(dom.one('.audio-editor-parametric-eq__handle').getAttribute('aria-label') ?? '', /1\.0 dB/u);
		await act(async () => reactProps(remaining).onKeyDown({
			key: 'Backspace', currentTarget: remaining, preventDefault() {}, stopPropagation() {},
		}));
		assert.equal(dom.container.querySelectorAll('.audio-editor-parametric-eq__handle').length, 0);
		assert.equal(globalThis.document.activeElement, dom.one('[role="application"]'));
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		if (priorContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', priorContext);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
		dom.restore();
	}
});
