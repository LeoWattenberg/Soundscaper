/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { NumberField } from '../vendor/audacity-design-system/components/src/ClipPropertiesPanel/clip-properties-controls.tsx';
import { ClipPropertiesPanel } from '../vendor/audacity-design-system/components/src/ClipPropertiesPanel/ClipPropertiesPanel.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const actual of [99.99999, 100.00001]) {
	for (const owner of ['field', 'panel'] as const) test(`a rounded clip ${owner} value ${actual} exposes its exact draft so unity can be restored`, async () => {
		const f = await fixture(actual, owner);
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

for (const owner of ['field', 'panel'] as const) test(`viewing an authored ${owner} speed below its input minimum does not clamp it`, async () => {
	const f = await fixture(0.1, owner, 1);
	try {
		await f.focus();
		assert.equal(f.input.value, '0.1');
		await f.blur();
		assert.deepEqual(f.commits, [], 'an existing out-of-range value is still authored state until explicitly edited');
	} finally { await f.cleanup(); }
});

async function fixture(value: number, owner: 'field' | 'panel' = 'field', min?: number) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: number[] = [];
	await act(async () => root.render(owner === 'field' ? <NumberField testId="speed" label="Speed" value={value} digits={2}
		glyph={null} min={min} onCommit={next => { commits.push(next); }} /> : <ClipPropertiesPanel
		clip={{ id: 'clip', name: 'Recording', trackName: 'Track', start: 0, duration: 1, trimStart: 0, fullDuration: 2,
			stretchFactor: 100 / value, pitchSemitones: 0, fadeIn: 0, fadeOut: 0 }} colors={[]} fadeShapes={[]}
		onSpeedChange={next => { commits.push(next); }} />));
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
