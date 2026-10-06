/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { NumberStepper } from '../vendor/audacity-design-system/components/src/NumberStepper/NumberStepper.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function stepValue(value: string, direction: 'up' | 'down', min?: number, max?: number): Promise<string> {
	const dom = installReactTestDom();
	const emitted: string[] = [];
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => { root.render(<NumberStepper value={value} step={10} min={min} max={max}
			onChange={(next) => emitted.push(next)} />); });
		const arrow = dom.one(`.number-stepper__arrow--${direction}`);
		const click = reactProps(arrow).onClick;
		assert.equal(typeof click, 'function');
		await act(async () => { (click as () => void)(); });
		assert.equal(emitted.length, 1);
		return emitted[0];
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

test('step arrows parse complete scientific and leading-decimal numbers while retaining units', async () => {
	assert.equal(await stepValue('1e3', 'up'), '1010');
	assert.equal(await stepValue('.5', 'up'), '10.5');
	assert.equal(await stepValue('+20 dB', 'down'), '10 dB');
	assert.equal(await stepValue('20dB', 'up'), '30 dB');
});

test('each step arrow clamps both bounds even when a typed draft begins outside them', async () => {
	assert.equal(await stepValue('-100', 'up', 0, 24_000), '0');
	assert.equal(await stepValue('25000', 'down', 1, 24_000), '24000');
	assert.equal(await stepValue('5', 'down', 0, 24_000), '0');
	assert.equal(await stepValue('23995', 'up', 0, 24_000), '24000');
});
