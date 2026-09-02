/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { ParametricEqEditor } from '../src/common/editor/ui/ParametricEqEditor.jsx';
import {
	installReactTestDom, reactProps, ReactTestElement,
} from './helpers/react-test-dom.ts';

test('the EQ point drag cannot capture the Q lane that its XY gesture does not edit', async () => {
	const fixture = await mountedEq();
	const checked: string[] = [];
	const begun: string[] = [];
	let staticBegins = 0;
	try {
		await fixture.render({
			captureAvailable(parameterId: string) {
				checked.push(parameterId);
				return parameterId === 'q';
			},
			begin(parameterId: string) { begun.push(parameterId); },
		}, () => { staticBegins += 1; });
		const handle = fixture.dom.one('.audio-editor-parametric-eq__handle');
		await act(async () => reactProps(handle).onPointerDown?.({
			button: 0, clientX: 100, clientY: 100, pointerId: 1,
			preventDefault() {}, stopPropagation() {},
			currentTarget: { setPointerCapture() {} },
		}));

		assert.deepEqual(checked, ['frequency', 'gain']);
		assert.deepEqual(begun, []);
		assert.equal(staticBegins, 1);
	} finally {
		await fixture.cleanup();
	}
});

test('keyboard focus alone does not begin an output-gain automation gesture', async () => {
	const fixture = await mountedEq();
	const calls: string[] = [];
	try {
		await fixture.render({
			captureAvailable(parameterId: string) { calls.push(`capture:${parameterId}`); return true; },
			begin(parameterId: string) { calls.push(`begin:${parameterId}`); },
		}, () => { calls.push('static-begin'); });
		const output = fixture.dom.one('.audio-editor-parametric-eq__output');
		const slider = output.querySelectorAll('input').find(({ type }) => type === 'range');
		assert.ok(slider);
		slider.focus();
		assert.equal(reactProps(slider).onFocus, undefined);
		assert.deepEqual(calls, []);
	} finally {
		await fixture.cleanup();
	}
});

async function mountedEq() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorRect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	const priorContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', {
		configurable: true,
		value: () => ({ width: 640, height: 220, left: 0, top: 0 }),
	});
	Object.defineProperty(ReactTestElement.prototype, 'getContext', {
		configurable: true,
		value: () => ({
			clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {},
			fillStyle: '',
		}),
	});
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		dom,
		render: async (parameterAutomation: Readonly<Record<string, unknown>>, onGestureBegin: () => void) => {
			await act(async () => root.render(<ParametricEqEditor
				params={{
					outputGain: 0,
					bands: [{
						id: 'voice-band', enabled: true, type: 'peaking',
						frequency: 1_000, gain: 3, q: 1, slope: 12,
					}],
				}}
				effectId="eq"
				onGestureBegin={onGestureBegin}
				onPreview={undefined}
				onCommit={undefined}
				onCancel={undefined}
				onAudition={undefined}
				readSpectrum={undefined}
				parameterAutomation={parameterAutomation}
			/>));
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			if (priorRect) Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', priorRect);
			else Reflect.deleteProperty(ReactTestElement.prototype, 'getBoundingClientRect');
			if (priorContext) Object.defineProperty(ReactTestElement.prototype, 'getContext', priorContext);
			else Reflect.deleteProperty(ReactTestElement.prototype, 'getContext');
			dom.restore();
		},
	};
}
