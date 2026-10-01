/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { Knob } from '../vendor/audacity-design-system/components/src/Knob/Knob.tsx';
import { Slider } from '../vendor/audacity-design-system/components/src/Slider/Slider.tsx';
import { PanKnob } from '../vendor/audacity-design-system/components/src/PanKnob/PanKnob.tsx';
import { MixerFader } from '../vendor/audacity-design-system/components/src/MixerFader/MixerFader.tsx';
import { SteppedSlider } from '../src/common/editor/ui/inspector/inspector-controls.jsx';
import ParameterNumber from '../src/common/editor/ui/inspector/EffectParameterNumber.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [name, Component, selector, defaultValue] of [
	['knob', Knob, 'button', 0],
	['slider', Slider, 'input', 50],
	['fractional slider', SteppedSlider, 'input', 0.75],
	['mixer fader', MixerFader, '.mixer-fader', 0],
] as const) {
	test(`double-clicking a ${name} resets its explicit default in one complete gesture`, async () => {
		await withMounted(async (root, dom) => {
			const events: [string, number][] = [];
			let stopped = 0;
			await act(async () => root.render(<Component
				value={30} min={0} max={100} step={0.01} defaultValue={defaultValue}
				ariaLabel="Parameter" valueText={undefined} disabled={false} onGestureCancel={undefined}
				onGestureStart={value => events.push(['start', value])}
				onChange={value => events.push(['change', value])}
				onGestureEnd={value => events.push(['end', value])}
			/>));
			await act(async () => {
				reactProps(dom.one(selector)).onDoubleClick({
					preventDefault() {}, stopPropagation() { stopped += 1; },
				});
			});
			assert.deepEqual(events, [['start', 30], ['change', defaultValue], ['end', defaultValue]]);
			assert.equal(stopped, 1);
		});
	});

	test(`${name} resets clamp to their bounds and leave disabled controls unchanged`, async () => {
		await withMounted(async (root, dom) => {
			const changes: number[] = [];
			const event = { preventDefault() {}, stopPropagation() {} };
			await act(async () => root.render(<Component
				value={30} min={0} max={100} step={1} defaultValue={200}
				ariaLabel="Parameter" valueText={undefined} disabled={false}
				onGestureStart={undefined} onGestureEnd={undefined} onGestureCancel={undefined}
				onChange={value => changes.push(value)}
			/>));
			await act(async () => { reactProps(dom.one(selector)).onDoubleClick(event); });
			assert.deepEqual(changes, [100]);
			await act(async () => root.render(<Component
				value={30} min={0} max={100} step={1} defaultValue={50} disabled
				ariaLabel="Parameter" valueText={undefined}
				onGestureStart={undefined} onGestureEnd={undefined} onGestureCancel={undefined}
				onChange={value => changes.push(value)}
			/>));
			await act(async () => { reactProps(dom.one(selector)).onDoubleClick(event); });
			assert.deepEqual(changes, [100]);
		});
	});
}

test('pan knobs reset to the center by default', async () => {
	await withMounted(async (root, dom) => {
		const changes: number[] = [];
		await act(async () => root.render(<PanKnob value={-25} onChange={value => changes.push(value)} />));
		await act(async () => { reactProps(dom.one('button')).onDoubleClick({ preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(changes, [0]);
	});
});

test('effect sliders restore the registered default without rounding it to their edit step', async () => {
	await withMounted(async (root, dom) => {
		const changes: number[] = [];
		await act(async () => root.render(<ParameterNumber
			label="Q" value={3} range={[0.1, 10]} step={0.01} defaultValue={0.707}
			presentation="slider" copy={{ parameterRangeError: 'Out of range' }} disabled={false}
			valueUnit={undefined} hook="q" timeCodeUnit={undefined}
			onGestureBegin={undefined} onGesturePreview={undefined} onGestureCommit={undefined} onGestureCancel={undefined}
			onCommit={(value: number) => { changes.push(value); }}
		/>));
		await act(async () => { reactProps(dom.one('input')).onDoubleClick({ preventDefault() {}, stopPropagation() {} }); });
		assert.deepEqual(changes, [0.707]);
	});
});

async function withMounted(
	run: (
		root: ReturnType<typeof import('react-dom/client')['createRoot']>,
		dom: ReturnType<typeof installReactTestDom>,
	) => Promise<void>,
): Promise<void> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await run(root, dom);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
}
