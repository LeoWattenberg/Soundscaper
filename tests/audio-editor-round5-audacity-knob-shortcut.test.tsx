/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import AudacityParameterKnob from '../src/common/editor/ui/AudacityParameterKnob.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

interface KeyOptions {
	readonly ctrlKey?: boolean;
	readonly altKey?: boolean;
	readonly metaKey?: boolean;
	readonly shiftKey?: boolean;
	readonly defaultPrevented?: boolean;
}

async function mountedKnob(run: (control: {
	key(type: 'onKeyDown' | 'onKeyUp', value: string, options?: KeyOptions): Promise<boolean>;
	value(): string | null;
	readonly starts: number[];
	readonly changes: number[];
	readonly ends: number[];
	readonly cancellations: number[];
}) => Promise<void>): Promise<void> {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const starts: number[] = [];
	const changes: number[] = [];
	const ends: number[] = [];
	const cancellations: number[] = [];
	let original = 75;
	function Control() {
		const [value, setValue] = useState(original);
		return <ThemeProvider><AudacityParameterKnob label="Room size" value={value}
			min={0} max={100} step={1} defaultValue={75}
			onChange={next => { changes.push(next); setValue(next); }}
			onGestureStart={next => { starts.push(next); original = next; }}
			onGestureEnd={next => ends.push(next)}
			onGestureCancel={() => { cancellations.push(original); setValue(original); }} /></ThemeProvider>;
	}
	try {
		await act(async () => { root.render(<Control />); });
		const knob = dom.one('[role="slider"]');
		knob.focus();
		await run({
			async key(type, value, options = {}) {
				let claimed = false;
				await act(async () => { reactProps(knob)[type]?.({
					key: value, ctrlKey: false, altKey: false, metaKey: false,
					shiftKey: false, defaultPrevented: false, ...options,
					preventDefault() { claimed = true; }, stopPropagation() { claimed = true; },
				}); });
				return claimed;
			},
			value: () => knob.getAttribute('aria-valuenow'), starts, changes, ends, cancellations,
		});
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previous;
		dom.restore();
	}
}

test('the actual-unit knob releases modified and already handled navigation without a gesture', async () => {
	await mountedKnob(async control => {
		for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { defaultPrevented: true }]) {
			for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
				assert.equal(await control.key('onKeyDown', key, options), false);
				await control.key('onKeyUp', key, options);
				assert.equal(control.value(), '75');
			}
		}
		assert.deepEqual(control.starts, []);
		assert.deepEqual(control.changes, []);
		assert.deepEqual(control.ends, []);
	});
});

test('the actual-unit knob keeps plain and Shift gestures with cancellation and owned release', async () => {
	await mountedKnob(async control => {
		assert.equal(await control.key('onKeyDown', 'ArrowDown'), true);
		assert.equal(control.value(), '74');
		await control.key('onKeyUp', 'ArrowDown', { ctrlKey: true });
		assert.deepEqual(control.ends, [], 'an unrelated modified release cannot complete this gesture');
		await control.key('onKeyDown', 'ArrowDown', { shiftKey: true });
		assert.equal(control.value(), '64');
		await control.key('onKeyDown', 'Escape');
		await control.key('onKeyUp', 'ArrowDown');
		assert.equal(control.value(), '75');
		assert.deepEqual(control.cancellations, [75]);
		assert.deepEqual(control.ends, []);
		for (const [key, value] of [['Home', '0'], ['End', '100']] as const) {
			await control.key('onKeyDown', key);
			assert.equal(control.value(), value);
			await control.key('onKeyUp', key);
		}
		assert.deepEqual(control.ends, [0, 100]);
	});
});
