/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ClipFadeShapeField from '../src/common/editor/ui/inspector/ClipFadeShapeField.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('fade-shape previews publish one completed edit and cancellation publishes none', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const committed: number[] = [];
	try {
		await act(async () => root.render(<ClipFadeShapeField label="Fade in shape" name="fadeInShape"
			value={1} fadeFrames={0} legacyLabel="Legacy" disabled={false}
			onCommit={(_name, value) => { committed.push(value); }} />));
		const slider = dom.one('input');
		const pointer = { pointerId: 1, button: 0, isPrimary: true, preventDefault() {} };
		await act(async () => reactProps(slider).onPointerDown(pointer));
		for (const value of ['2', '3', '4']) {
			await act(async () => reactProps(slider).onChange({ currentTarget: { value } }));
			assert.deepEqual(committed, []);
		}
		await act(async () => reactProps(slider).onPointerUp(pointer));
		assert.deepEqual(committed, [4]);
		await act(async () => reactProps(slider).onPointerDown(pointer));
		await act(async () => reactProps(slider).onChange({ currentTarget: { value: '5' } }));
		let prevented = false;
		await act(async () => reactProps(slider).onKeyDown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} }));
		assert.equal(prevented, true);
		assert.equal(slider.value, '1');
		await act(async () => reactProps(slider).onChange({ currentTarget: { value: '5.5' } }));
		await act(async () => reactProps(slider).onPointerUp(pointer));
		const trailingInput = { currentTarget: { value: '5' } };
		await act(async () => reactProps(slider).onChange(trailingInput));
		assert.equal(trailingInput.currentTarget.value, '1');
		assert.deepEqual(committed, [4]);
		await act(async () => reactProps(slider).onPointerDown(pointer));
		await act(async () => reactProps(slider).onChange({ currentTarget: { value: '2' } }));
		await act(async () => reactProps(slider).onPointerUp(pointer));
		assert.deepEqual(committed, [4, 2]);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
