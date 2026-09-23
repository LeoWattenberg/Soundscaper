/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';

import { AudacityWaveformCanvases } from '../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx';
import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('pending zoom redraws old peak columns as a fine line until a finer window arrives', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorComputedStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'getComputedStyle', {
		configurable: true,
		value: () => ({ getPropertyValue: () => '' }),
	});
	Object.assign(globalThis.window, {
		requestAnimationFrame: globalThis.requestAnimationFrame,
		cancelAnimationFrame: globalThis.cancelAnimationFrame,
		devicePixelRatio: 1,
	});

	let liveWidth = 100;
	let backingWidth = 0;
	let backingHeight = 0;
	let resizeWrites = 0;
	let clears = 0;
	let fills = 0;
	let lineSegments = 0;
	let painted = false;
	const context = {
		save() {},
		restore() {},
		setTransform() {},
		clearRect() {
			clears += 1;
			painted = false;
		},
		fillRect() {
			fills += 1;
			painted = true;
		},
		beginPath() {},
		rect() {},
		clip() {},
		moveTo() {},
		lineTo() { lineSegments += 1; },
		stroke() { painted = true; },
	};
	const canvas = {
		dataset: {} as Record<string, string>,
		style: { width: '', height: '', removeProperty() {} },
		get width() { return backingWidth; },
		set width(value: number) {
			backingWidth = value;
			resizeWrites += 1;
			painted = false;
		},
		get height() { return backingHeight; },
		set height(value: number) {
			backingHeight = value;
			resizeWrites += 1;
			painted = false;
		},
		get clientWidth() { return liveWidth; },
		getContext: () => context,
		getBoundingClientRect: () => ({ width: liveWidth, height: 40 }),
		closest: () => ({ dataset: { color: 'blue' } }),
		__kwWaveformPlan: undefined as unknown,
	};
	const clipElement = {
		dataset: { clipId: 'clip' },
		querySelector: () => canvas,
	};
	const trackRoot = {
		querySelectorAll: () => [clipElement],
		closest: () => ({ dataset: { editorTheme: '' } }),
	};
	const plan = {
		mode: 'summary',
		sourceId: 'source-a',
		pixelWidth: 100,
		pixelsPerSample: 0.03125,
		peakBlockSize: 8,
		startFrame: 0,
		endFrame: 48_000,
		frameCount: 48_000,
		channels: [{
			minimum: new Float32Array(100).fill(-0.5),
			maximum: new Float32Array(100).fill(0.5),
			rms: new Float32Array(100).fill(0.25),
		}],
	};
	const clipBase = { id: 'clip', sourceId: 'source-a', start: 0, duration: 1, trimStart: 0, color: 'blue' };
	const baseProps = {
		rootRef: { current: trackRoot },
		displayMode: 'waveform',
		pixelsPerSecond: 100,
		timeSelection: null,
		showRms: false,
		halfWave: false,
		verticalZoom: 0,
		channelHeightRatio: 0.5,
		spectrogramOptions: {
			scale: 'linear',
			minFreq: 0,
			maxFreq: 24_000,
			fftWindowSize: 256,
			windowType: 'hann',
			gainDb: 0,
			rangeDb: 80,
			sampleRate: 48_000,
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (clips: readonly Record<string, unknown>[], pixelsPerSecond: number) => {
		await act(async () => root.render(<ThemeProvider theme={resolveSkinTheme('default', 'light')}>
			<AudacityWaveformCanvases {...baseProps} clips={clips} pixelsPerSecond={pixelsPerSecond} />
		</ThemeProvider>));
	};

	try {
		await render([{ ...clipBase, audacityWaveform: plan }], 100);
		assert.equal(clears, 1);
		assert.ok(fills > 0);
		assert.equal(painted, true);
		assert.strictEqual(canvas.__kwWaveformPlan, plan);
		const clearsAfterPaint = clears;
		const resizeWritesAfterPaint = resizeWrites;

		liveWidth = 400;
		await render([{ ...clipBase, waveformPending: true }], 400);

		assert.equal(clears, clearsAfterPaint + 1, 'pending zoom redraws from the old columns');
		assert.ok(resizeWrites > resizeWritesAfterPaint, 'the backing canvas tracks the new clip width');
		assert.equal(canvas.width, 400);
		assert.equal(painted, true);
		assert.ok(lineSegments > 0, 'the fallback connects peak-column centers');
		assert.strictEqual(canvas.__kwWaveformPlan, plan);
		assert.equal(canvas.dataset.waveformPending, 'true');
		assert.equal(canvas.dataset.waveformSource, 'interpolated-peaks');
		assert.equal(canvas.dataset.waveformMode, 'connecting-dots');
		const effectivePeakWidth = plan.peakBlockSize * plan.pixelsPerSample
			* liveWidth / plan.pixelWidth;
		assert.ok(effectivePeakWidth <= 1, 'the average peak width does not prove warp-local resolution');
		const clearsAfterOutline = clears;
		const segmentsAfterOutline = lineSegments;
		await render([{ ...clipBase, waveformPending: true }], 400);
		assert.equal(clears, clearsAfterOutline, 'an unchanged pending outline does not repaint');
		assert.equal(lineSegments, segmentsAfterOutline);

		liveWidth = 1_600;
		await render([{ ...clipBase, waveformPending: true }], 1_600);
		assert.equal(canvas.width, 1_600);
		assert.equal(canvas.dataset.waveformSource, 'interpolated-peaks');
		assert.equal(painted, true);

		const finePlan = {
			...plan,
			pixelWidth: 1_600,
			pixelsPerSample: 0.001,
			channels: [{
				minimum: new Float32Array(1_600).fill(-0.5),
				maximum: new Float32Array(1_600).fill(0.5),
				rms: new Float32Array(1_600).fill(0.25),
			}],
		};
		await render([{ ...clipBase, audacityWaveform: finePlan }], 1_600);
		assert.strictEqual(canvas.__kwWaveformPlan, finePlan);
		assert.equal(canvas.dataset.waveformSource, 'peaks');
		assert.equal(canvas.dataset.waveformPending, undefined);
		assert.equal(painted, true);

		liveWidth = 50;
		await render([{ ...clipBase, waveformPending: true }], 50);
		assert.equal(canvas.width, 50);
		assert.equal(canvas.dataset.waveformSource, 'peaks');
		assert.equal(painted, true);

		const roundedPlan = { ...plan, pixelWidth: 49, pixelsPerSample: 0.125 };
		await render([{ ...clipBase, audacityWaveform: roundedPlan }], 50);
		assert.equal(canvas.dataset.waveformSource, 'interpolated-peaks',
			'actual canvas width makes one-pixel nominal peak buckets too wide');
		assert.equal(painted, true);

		await render([{ ...clipBase, trimStart: 0.1, waveformPending: true }], 50);
		assert.equal(canvas.__kwWaveformPlan, undefined,
			'a pending clip with a changed source range cannot reuse the previous plan');
		await render([{ ...clipBase, audacityWaveform: plan }], 100);
		await render([{ ...clipBase, sourceId: 'source-b', waveformPending: true }], 100);
		assert.equal(canvas.__kwWaveformPlan, undefined,
			'a pending clip with a changed source cannot reuse the previous audio');
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		if (priorComputedStyle) Object.defineProperty(globalThis, 'getComputedStyle', priorComputedStyle);
		else Reflect.deleteProperty(globalThis, 'getComputedStyle');
		dom.restore();
	}
});
