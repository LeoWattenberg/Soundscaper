/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import NyquistNumberInput from '../src/common/editor/ui/dialogs/NyquistNumberInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Nyquist numeric drafts survive negative prefixes and canonical live echoes', async () => {
	const dom = installReactTestDom();
	const global = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = global.IS_REACT_ACT_ENVIRONMENT;
	global.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let current = 0;
	const changes: number[] = [];
	const render = () => root.render(<NyquistNumberInput value={current} minimum={-100} maximum={100}
		disabled={false} integer={false} onChange={value => { current = value; changes.push(value); render(); }} />);
	try {
		await act(async () => render());
		const input = dom.one('input');
		await act(async () => reactProps(input).onFocus());
		for (const value of ['', '-', '-0', '-0.', '-0.5']) {
			await act(async () => reactProps(input).onChange({ currentTarget: { value,
				valueAsNumber: value.trim() ? Number(value) : Number.NaN } }));
			assert.equal(input.value, value);
		}
		await act(async () => reactProps(input).onBlur());
		assert.equal(current, -0.5);
		assert.equal(input.value, '-0.5');
		assert.equal(changes.some(value => Number.isNaN(value)), false);
		await act(async () => reactProps(input).onFocus());
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '10', valueAsNumber: 10 } }));
		await act(async () => reactProps(input).onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }));
		assert.equal(current, -0.5);
		assert.equal(input.value, '-0.5');
		await act(async () => reactProps(input).onBlur());
		assert.equal(current, -0.5);
	} finally {
		await act(async () => root.unmount());
		global.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
});
