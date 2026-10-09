/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { useParametricEqSpectrum } from '../src/common/editor/ui/useParametricEqSpectrum.ts';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

async function draw(bin: number, nativeRate: number, width = 800): Promise<readonly (readonly [number, number])[]> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorContext = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getContext');
	const priorRect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const points: Array<readonly [number, number]> = [];
	const context = { clearRect() { points.length = 0; }, beginPath() {}, moveTo() {}, closePath() {}, fill() {},
		fillStyle: '', lineTo(x: number, y: number) { points.push([x, y]); } };
	Object.defineProperty(ReactTestElement.prototype, 'getContext', { configurable: true,
		value(this: ReactTestElement) { return this.getAttribute('data-spectrum-input') ? context : null; } });
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', { configurable: true,
		value: () => ({ width, height: 100, left: 0, top: 0 }) });
	const frames: FrameRequestCallback[] = [];
	globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
	function View(): React.ReactElement {
		const refs = useParametricEqSpectrum({ sampleRate: 48_000, showInput: true, showOutput: false,
			readSpectrum: (_source, values) => {
				values.fill(-120); if (bin >= 0) values[bin] = -12;
				return { sampleRate: nativeRate, fftSize: 4096, frequencyBinCount: 2048 };
			} });
		return <><canvas ref={refs.inputCanvasRef} data-spectrum-input="true" /><canvas ref={refs.outputCanvasRef} /></>;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<View />));
		const frame = frames.shift(); assert.ok(frame); await act(async () => frame(40));
		return [...points];
	} finally {
		await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		for (const [target, key, descriptor] of [
			[globalThis, 'React', priorReact], [ReactTestElement.prototype, 'getContext', priorContext],
			[ReactTestElement.prototype, 'getBoundingClientRect', priorRect],
		] as const) {
			if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key);
		}
		dom.restore();
	}
}

for (const bin of [1039, 1393, 1990]) test(`the EQ spectrum retains a narrow loud FFT peak at bin ${bin}`, async () => {
	const points = await draw(bin, 48_000);
	assert.ok(Math.min(...points.map(([, y]) => y)) < 11, 'the -12 dB input peak must remain visible');
});

test('the EQ spectrum positions FFT bins by the analyser native clock', async () => {
	const points = await draw(128, 44_100);
	const loud = points.filter(([, y]) => y < 11).map(([x]) => x);
	assert.ok(loud.length > 0);
	const expected = Math.log((128 * 44_100 / 4096) / 10) / Math.log(23_520 / 10) * 799;
	assert.ok(Math.abs(loud.reduce((sum, x) => sum + x, 0) / loud.length - expected) < 4,
		'the visible peak must use its native FFT frequency');
});

test('the EQ spectrum retains digital silence at its original floor', async () => {
	const points = await draw(-1, 48_000);
	assert.equal(Math.min(...points.map(([, y]) => y)), 100);
});
