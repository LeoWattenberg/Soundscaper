/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { NumberField } from '../vendor/audacity-design-system/components/src/ClipPropertiesPanel/clip-properties-controls.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const actual of [99.99999, 100.00001]) {
	test(`a rounded clip value ${actual} exposes its exact draft so unity can be restored`, async () => {
		const f = await fixture(actual);
		try {
			assert.equal(f.input.value, '100', 'the unfocused field keeps its compact presentation');
			await f.focus();
			assert.equal(f.input.value, String(actual), 'focus reveals the exact authored value');
			await f.blur();
			assert.deepEqual(f.commits, [], 'focus and blur must never normalize authored precision');
			await f.focus();
			await act(async () => reactProps(f.input).onChange({ target: { value: '100' } }));
			await f.blur();
			assert.deepEqual(f.commits, [100], 'typing the displayed neutral value performs one deliberate edit');
		} finally { await f.cleanup(); }
	});
}

test('Escape discards an exact clip draft before synchronous blur can commit it', async () => {
	const f = await fixture(100.00001);
	try {
		await f.focus();
		await act(async () => reactProps(f.input).onChange({ target: { value: '125' } }));
		Object.defineProperty(f.input, 'blur', { configurable: true, value: () => reactProps(f.field).onBlur({ target: f.input }) });
		await act(async () => reactProps(f.field).onKeyDown({ key: 'Escape', stopPropagation() {} }));
		assert.deepEqual(f.commits, []);
		assert.equal(f.input.value, '100');
	} finally { await f.cleanup(); }
});

async function fixture(value: number) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: number[] = [];
	await act(async () => root.render(<NumberField testId="speed" label="Speed" value={value} digits={2}
		glyph={null} onCommit={next => { commits.push(next); }} />));
	const field = dom.one('[data-clip-properties-field="speed"]');
	const input = field.querySelector('input');
	assert.ok(input);
	return { field, input, commits,
		async focus() {
			input.focus();
			await act(async () => reactProps(field).onFocusCapture?.({ target: input }));
		},
		async blur() {
			await act(async () => reactProps(field).onBlur({ target: input }));
		},
		async cleanup() {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			dom.restore();
		},
	};
}
