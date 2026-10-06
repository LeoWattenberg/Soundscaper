/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import PreferenceNumberInput from '../src/common/editor/ui/dialogs/PreferenceNumberInput.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('bounded preference numbers retain intermediate keystrokes and save only the completed value', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const saved: number[] = [];
	try {
		await act(async () => root.render(<PreferenceNumberInput label="Maximum frequency (Hz)"
			value={20_000} minimum={1_001} maximum={24_000} onCommit={(value) => { saved.push(value); }} />));
		const input = dom.one('input');
		for (const value of ['', '8', '80', '800', '8000']) {
			await act(async () => reactProps(input).onChange({ currentTarget: { value } }));
			assert.equal(input.value, value);
			assert.deepEqual(saved, []);
		}
		await act(async () => reactProps(input).onBlur());
		assert.deepEqual(saved, [8_000]);
		await act(async () => reactProps(input).onChange({ currentTarget: { value: '' } }));
		await act(async () => reactProps(input).onBlur());
		assert.equal(input.value, '20000');
		assert.deepEqual(saved, [8_000]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
