/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import ParameterNumber from '../src/common/editor/ui/inspector/EffectParameterNumber.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

(globalThis as unknown as { React: unknown }).React = React;

async function mountNumber() {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const commits: number[] = [];
	await act(async () => root.render(<ParameterNumber label="Gain" value={-6}
		range={[-50, 50]} step={0.1} presentation="slider" hook="gainDb"
		valueUnit={undefined} defaultValue={-6} disabled={false} timeCodeUnit={undefined}
		onGestureBegin={undefined} onGesturePreview={undefined}
		onGestureCommit={undefined} onGestureCancel={undefined}
		copy={{ parameterRangeError: '{label}: {minimum} to {maximum}' }}
		onCommit={(value: number) => commits.push(value)} />));
	return { dom, commits, async dispose() {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	} };
}

test('an empty effect number never commits zero', async () => {
	const mounted = await mountNumber();
	try {
		const number = mounted.dom.one('.text-input__field');
		await act(async () => reactProps(number).onChange({ target: { value: '' } }));
		await act(async () => reactProps(number).onBlur());
		assert.deepEqual(mounted.commits, []);
	} finally {
		await mounted.dispose();
	}
});

test('a rejected numeric effect draft is exposed as invalid', async () => {
	const mounted = await mountNumber();
	try {
		const number = mounted.dom.one('.text-input__field');
		await act(async () => reactProps(number).onChange({ target: { value: '1000' } }));
		await act(async () => reactProps(number).onBlur());
		assert.deepEqual(mounted.commits, []);
		assert.equal(number.getAttribute('aria-invalid'), 'true');
	} finally {
		await mounted.dispose();
	}
});
