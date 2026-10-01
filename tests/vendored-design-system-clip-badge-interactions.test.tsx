/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import React, { act } from 'react';

import { ClipHeader } from '../vendor/audacity-design-system/components/src/ClipHeader/ClipHeader.tsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let priorAct: boolean | undefined;
beforeEach(() => { priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct; });

test('badge pointer clicks defer opening properties so double-click can reset alone', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const calls: string[] = [];
	const callbacks: Record<string, unknown> = {
		onPitchClick: () => { calls.push('pitch open'); },
		onSpeedClick: () => { calls.push('speed open'); },
		onPitchReset: () => { calls.push('pitch reset'); },
		onSpeedReset: () => { calls.push('speed reset'); },
	};
	await act(async () => root.render(<ClipHeader showPitch pitchValue="+1" showStretch stretchPercent={50} {...callbacks} />));
	try {
		for (const control of ['pitch', 'speed']) {
			const button = dom.one(`[aria-label="Clip ${control}"]`);
			assert.equal(button.tagName, 'BUTTON');
			assert.equal(button.getAttribute('aria-description'), control === 'pitch' ? '+1' : '50%');
			const props = reactProps(button);
			let stopped = 0;
			const event = (detail: number) => ({ detail, stopPropagation() { stopped += 1; } });
			await act(async () => props.onClick(event(1)));
			assert.deepEqual(calls, [], 'the first click lets a reset gesture finish');
			await act(async () => {
				props.onClick(event(2));
				props.onDoubleClick(event(2));
				context.mock.timers.tick(1_000);
			});
			assert.deepEqual(calls, [`${control} reset`]);
			assert.equal(stopped, 3, 'badge clicks do not select or drag the clip');
			calls.length = 0;
			await act(async () => {
				props.onClick(event(1));
				context.mock.timers.tick(1_000);
			});
			assert.deepEqual(calls, [`${control} open`]);
			calls.length = 0;
			await act(async () => props.onClick(event(0)));
			assert.deepEqual(calls, [`${control} open`], 'keyboard activation opens immediately');
			calls.length = 0;
		}
	} finally {
		await act(async () => root.unmount());
		dom.restore();
	}
});

test('a badge cancels its delayed property request on unmount', async (context) => {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let opened = 0;
	const callbacks: Record<string, unknown> = { onSpeedClick: () => { opened += 1; }, onSpeedReset() {} };
	await act(async () => root.render(<ClipHeader showStretch stretchPercent={50} {...callbacks} />));
	await act(async () => reactProps(dom.one('[aria-label="Clip speed"]')).onClick({ detail: 1, stopPropagation() {} }));
	await act(async () => root.unmount());
	context.mock.timers.tick(1_000);
	assert.equal(opened, 0);
	dom.restore();
});
