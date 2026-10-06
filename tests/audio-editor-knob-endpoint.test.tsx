/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';

import { Knob } from '../vendor/audacity-design-system/components/src/Knob/Knob.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Home and End publish knob endpoints with one completed gesture each', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const starts: number[] = [];
	const ends: number[] = [];
	function Control() {
		const [value, setValue] = useState(0);
		return <Knob label="Pan" value={value} min={-100} max={100} onChange={setValue}
			onGestureStart={(next) => starts.push(next)} onGestureEnd={(next) => ends.push(next)} />;
	}
	try {
		await act(async () => root.render(<Control />));
		const knob = dom.one('button');
		for (const [key, value] of [['Home', '-100'], ['End', '100']] as const) {
			const event = { key, preventDefault() {}, stopPropagation() {} };
			await act(async () => reactProps(knob).onKeyDown(event));
			assert.equal(knob.getAttribute('aria-valuenow'), value);
			await act(async () => reactProps(knob).onKeyUp(event));
			await act(async () => reactProps(knob).onBlur());
		}
		assert.deepEqual(starts, [0, -100]);
		assert.deepEqual(ends, [-100, 100]);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
