/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import VideoEffectNumberInput from '../src/common/editor/ui/inspector/VideoEffectNumberInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('a secondary click keeps a video numeric draft available for ordinary Escape cancellation', async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let current = 0; let original = 0; let commits = 0; let cancels = 0;
	const render = () => root.render(<VideoEffectNumberInput value={current} minimum={-1} maximum={1}
		step={0.01} label="Brightness" disabled={false} onBegin={() => { original = current; }}
		onPreview={value => { current = value; render(); }} onCommit={() => { commits++; }}
		onCancel={() => { cancels++; current = original; render(); }} />);
	try {
		await act(async () => { render(); });
		const input = dom.one('input');
		const change = async (value: number) => {
			await act(async () => { reactProps(input).onChange({ currentTarget: { value: String(value), valueAsNumber: value } }); });
		};
		await change(0.2);
		await act(async () => { reactProps(input).onKeyDown({ key: 'Enter', preventDefault() {} }); });
		assert.equal(commits, 1, 'healthy keyboard confirmation commits once');
		await change(0.3);
		await act(async () => { reactProps(input).onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); });
		assert.equal(current, 0.2, 'healthy unconfirmed replacement can be cancelled');
		await change(0.4);
		await act(async () => { reactProps(input).onPointerDown({ currentTarget: input, pointerId: 7, button: 2, isPrimary: true }); });
		await act(async () => { reactProps(input).onPointerUp({ currentTarget: input, pointerId: 7, button: 2, isPrimary: true }); });
		assert.equal(commits, 1, 'opening the native text context menu cannot confirm its current draft');
		await act(async () => { reactProps(input).onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); });
		assert.equal(current, 0.2);
		assert.equal(input.value, '0.2');
		assert.equal(cancels, 2);
	} finally {
		await act(async () => { root.unmount(); });
		environment.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
});

test('only the held primary contact can finish a video numeric preview', async () => {
	const dom = installReactTestDom();
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let current = 0; let commits = 0; let cancels = 0;
	const render = () => root.render(<VideoEffectNumberInput value={current} minimum={-1} maximum={1}
		step={0.01} label="Brightness" disabled={false} onBegin={() => undefined}
		onPreview={value => { current = value; render(); }} onCommit={() => { commits++; }}
		onCancel={() => { cancels++; current = 0; render(); }} />);
	try {
		await act(async () => { render(); });
		const input = dom.one('input');
		const first = { currentTarget: input, pointerId: 3, button: 0, isPrimary: true, preventDefault() {} };
		const second = { ...first, pointerId: 4, isPrimary: false };
		await act(async () => { reactProps(input).onPointerDown(first); });
		await act(async () => { reactProps(input).onChange({ currentTarget: { value: '0.2', valueAsNumber: 0.2 } }); });
		await act(async () => { reactProps(input).onPointerDown(second); });
		await act(async () => { reactProps(input).onPointerCancel(second); });
		assert.equal(current, 0.2, 'a foreign cancelled contact cannot roll back the accepted preview');
		assert.equal(cancels, 0);
		await act(async () => { reactProps(input).onPointerUp(second); });
		assert.equal(commits, 0, 'a foreign released contact cannot commit the accepted preview');
		await act(async () => { reactProps(input).onPointerUp(first); });
		assert.equal(commits, 1, 'the healthy primary release commits once');
		await act(async () => { reactProps(input).onBlur(); });
		assert.equal(commits, 1);
	} finally {
		await act(async () => { root.unmount(); });
		environment.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
});
