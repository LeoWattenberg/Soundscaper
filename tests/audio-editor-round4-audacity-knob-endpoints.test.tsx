/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import AudacityParameterKnob from '../src/common/editor/ui/AudacityParameterKnob.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('the accessible Audacity knob owns endpoint gestures in actual units', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const starts: number[] = [];
	const changes: number[] = [];
	const ends: number[] = [];
	let canceled = 0;
	let original = -10;
	function Control() {
		const [value, setValue] = useState(original);
		return <ThemeProvider><AudacityParameterKnob label="Threshold" value={value}
			min={-60} max={0} step={0.1} defaultValue={-10}
			onChange={next => { changes.push(next); setValue(next); }}
			onGestureStart={next => { starts.push(next); original = next; }}
			onGestureEnd={next => ends.push(next)}
			onGestureCancel={() => { canceled += 1; setValue(original); }} /></ThemeProvider>;
	}
	const key = (value: string) => ({ key: value, shiftKey: false, preventDefault() {}, stopPropagation() {} });
	try {
		await act(async () => { root.render(<Control />); });
		const knob = dom.one('[role="slider"]');
		knob.focus();
		for (const [value, expected] of [['Home', '-60'], ['End', '0']] as const) {
			await act(async () => { reactProps(knob).onKeyDown?.(key(value)); });
			await act(async () => { reactProps(knob).onKeyDown?.(key(value)); });
			assert.equal(knob.getAttribute('aria-valuenow'), expected);
			await act(async () => { reactProps(knob).onKeyUp?.(key(value)); });
			await act(async () => { reactProps(knob).onBlur?.({}); });
		}
		assert.deepEqual(starts, [-10, -60]);
		assert.deepEqual(changes, [-60, 0], 'holding an endpoint key does not republish the same value');
		assert.deepEqual(ends, [-60, 0], 'each endpoint key completes one transaction');
		await act(async () => { reactProps(knob).onKeyDown?.(key('Home')); });
		assert.equal(knob.getAttribute('aria-valuenow'), '-60');
		await act(async () => { reactProps(knob).onKeyDown?.(key('Escape')); });
		await act(async () => { reactProps(knob).onKeyUp?.(key('Home')); });
		assert.equal(knob.getAttribute('aria-valuenow'), '0');
		assert.equal(canceled, 1);
		assert.deepEqual(ends, [-60, 0], 'release cannot commit a canceled endpoint gesture');
		assert.equal(knob.ownerDocument.activeElement, knob);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
});
