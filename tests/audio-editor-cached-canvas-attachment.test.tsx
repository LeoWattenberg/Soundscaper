/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useCallback, useRef } from 'react';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';
import { AudacityWaveformCanvases } from '../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx';
import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

void test('cached waveform rows paint on attachment and virtualized remount without media publications', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const previousStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ getPropertyValue: () => '' }) });
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	window.cancelAnimationFrame = frame => { frames.delete(frame); };
	window.devicePixelRatio = 1;
	let clears = 0;
	const context = { save() {}, restore() {}, setTransform() {}, clearRect() { clears++; }, fillRect() {},
		beginPath() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {} };
	const createCanvas = () => ({ width: 0, height: 0, dataset: {} as Record<string, string>,
		style: { width: '', height: '', removeProperty() {} }, getContext: () => context,
		getBoundingClientRect: () => ({ width: 100, height: 40 }), closest: () => ({ dataset: { color: 'blue' } }) });
	let canvas = createCanvas();
	const clipElement = { dataset: { clipId: 'clip' }, querySelector: () => canvas };
	const plan = { mode: 'summary', pixelWidth: 100, pixelsPerSample: 0.03125, peakBlockSize: 8,
		startFrame: 0, endFrame: 48_000, frameCount: 48_000,
		channels: [{ minimum: new Float32Array(100).fill(-0.5), maximum: new Float32Array(100).fill(0.5), rms: null }] };
	const clips = [{ id: 'clip', sourceId: 'source', start: 0, duration: 1, trimStart: 0, color: 'blue', audacityWaveform: plan }];
	const spectrogramOptions = { scale: 'linear', minFreq: 0, maxFreq: 24_000, fftWindowSize: 256,
		windowType: 'hann', gainDb: 0, rangeDb: 80, sampleRate: 48_000 };
	function Harness() {
		const rootRef = useRef<HTMLDivElement | null>(null);
		const attach = useCallback((element: HTMLDivElement | null) => {
			rootRef.current = element;
			if (element) Object.assign(element, { querySelectorAll: () => [clipElement], closest: () => null });
		}, []);
		return <ThemeProvider theme={resolveSkinTheme('default', 'light')}><div ref={attach}>
			<AudacityWaveformCanvases rootRef={rootRef} clips={clips} displayMode="waveform"
				pixelsPerSecond={100} timeSelection={null} showRms={false} halfWave={false} verticalZoom={0}
				channelHeightRatio={0.5} spectrogramOptions={spectrogramOptions} />
		</div></ThemeProvider>;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const flush = async () => {
		await act(async () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); });
	};
	try {
		await act(async () => root.render(<Harness />));
		assert.equal(clears, 0, 'the child mounts before its parent ref attaches');
		assert.equal(frames.size, 1, 'cached data needs no publication to retry host attachment');
		await flush();
		assert.equal(clears, 1);
		assert.equal(canvas.dataset.waveformRenderer, 'audacity');
		await act(async () => root.render(null));
		assert.equal(frames.size, 0);
		canvas = createCanvas();
		await act(async () => root.render(<Harness />));
		assert.equal(frames.size, 1, 'a virtualized remount retries the same cached plans');
		await flush();
		assert.equal(clears, 2);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		if (previousStyle) Object.defineProperty(globalThis, 'getComputedStyle', previousStyle);
		else Reflect.deleteProperty(globalThis, 'getComputedStyle');
		dom.restore();
	}
});
