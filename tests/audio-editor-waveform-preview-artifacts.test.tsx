/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ThemeProvider } from '@soundscaper/design-system/ThemeProvider';

import { AudacityWaveformCanvases } from '../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx';
import { resolveSkinTheme } from '../src/common/editor/ui/skins/skin-themes.ts';
import type { FrequencyWaveformProjection } from '../src/common/editor/ui/timeline/frequency-waveform-projection.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

type DisplayMode = 'waveform' | 'waveform-three-band' | 'waveform-rainbow';
type Point = readonly [number, number];
interface Fill { x: number; y: number; width: number; height: number; color: string; alpha: number }

const HEIGHT = 64;
const FRAME_COUNT = 48_000;
const clip = {
	id: 'clip', sourceId: 'source', waveformIdentity: 'unchanged-audio',
	start: 0, duration: 1, trimStart: 0, color: 'blue',
	waveformStartFrame: 0, waveformEndFrame: FRAME_COUNT,
};
const rendering = {
	mode: 'summary', sourceId: clip.sourceId, waveformIdentity: clip.waveformIdentity,
	startFrame: 0, endFrame: FRAME_COUNT, frameCount: FRAME_COUNT,
	pixelWidth: 96, pixelsPerSample: 96 / FRAME_COUNT, peakBlockSize: 128,
	channels: [{
		minimum: Float32Array.from({ length: 96 }, (_, column) => -0.4 - 0.3 * Math.abs(Math.sin(column / 5))),
		maximum: Float32Array.from({ length: 96 }, (_, column) => 0.3 + 0.4 * Math.abs(Math.cos(column / 7))),
		rms: new Float32Array(96).fill(0.25),
	}],
};
const frequency: FrequencyWaveformProjection = {
	sampleRate: FRAME_COUNT, peakBlockSize: 128,
	bands: { low: frequencyBand(1), mid: frequencyBand(0.5), high: frequencyBand(1 / 3) },
	centroidHz: Float32Array.from({ length: 96 }, (_, column) => 120 + column * 150),
	centroidWeight: new Float32Array(96).fill(1),
};

function frequencyBand(gain: number): FrequencyWaveformProjection['bands']['low'] {
	return {
		...rendering,
		channels: rendering.channels.map((channel) => ({
			minimum: channel.minimum.map((value) => value * gain),
			maximum: channel.maximum.map((value) => value * gain),
			rms: null,
		})),
	};
}

for (const mode of ['waveform', 'waveform-three-band', 'waveform-rainbow'] as const) {
	for (const theme of ['light', 'dark'] as const) {
		test(`${mode} ${theme} zoom previews fill audio without synthetic peak contours`, async () => {
			const fixture = await createFixture(mode, theme);
			try {
				await fixture.render(96, { audacityWaveform: rendering, frequencyWaveform: frequency });
				fixture.assertFilledWithoutContours('initial summary');

				// Exercise the coarse ready-plan branch as well as the missing-window
				// branch: both formerly manufactured upper/lower sample polylines.
				await fixture.render(384, { audacityWaveform: rendering, frequencyWaveform: frequency, waveformPending: true });
				fixture.assertFilledWithoutContours('stretched coarse summary');
				await fixture.render(1_536, { waveformPending: true });
				fixture.assertFilledWithoutContours('pending zoom in');
				await fixture.render(48, { waveformPending: true });
				fixture.assertFilledWithoutContours('pending zoom out');
				await fixture.render(768, {
					waveformPending: true, trimStart: 0.25, duration: 0.5,
					waveformStartFrame: FRAME_COUNT / 4, waveformEndFrame: FRAME_COUNT * 3 / 4,
				});
				fixture.assertFilledWithoutContours('pending cropped viewport');
			} finally {
				await fixture.dispose();
			}
		});
	}
}

async function createFixture(mode: DisplayMode, theme: 'light' | 'dark') {
	const dom = installReactTestDom();
	const restoredGlobals = new Map(['React', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT']
		.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.defineProperties(globalThis, {
		React: { configurable: true, value: React },
		IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
		getComputedStyle: { configurable: true, value: () => ({
			colorScheme: theme,
			getPropertyValue: (name: string) => name.includes('divider') ? '#888' : '',
		}) },
	});
	Object.assign(window, {
		requestAnimationFrame: globalThis.requestAnimationFrame,
		cancelAnimationFrame: globalThis.cancelAnimationFrame,
		devicePixelRatio: theme === 'light' ? 1 : 2,
	});
	let liveWidth = 96;
	let path: Point[] = [];
	const strokes: Point[][] = [];
	const fills: Fill[] = [];
	const context = {
		fillStyle: '#000', globalAlpha: 1,
		save() {}, restore() {}, setTransform() {}, rect() {}, clip() {},
		clearRect() { fills.length = 0; strokes.length = 0; },
		fillRect(x: number, y: number, width: number, height: number) {
			fills.push({ x, y, width, height, color: context.fillStyle, alpha: context.globalAlpha });
		},
		beginPath() { path = []; },
		moveTo(x: number, y: number) { path.push([x, y]); },
		lineTo(x: number, y: number) { path.push([x, y]); },
		stroke() { strokes.push([...path]); },
	};
	const canvas = {
		width: 0, height: 0, dataset: {} as Record<string, string>,
		style: { width: '', height: '', removeProperty() {} },
		getContext: () => context,
		getBoundingClientRect: () => ({ width: liveWidth, height: HEIGHT }),
		closest: () => ({ dataset: { color: 'blue' } }),
	};
	const rootRef = { current: {
		querySelectorAll: () => [{ dataset: { clipId: clip.id }, querySelector: () => canvas }],
		closest: () => ({ dataset: {} }),
	} };
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		async render(width: number, fields: Readonly<Record<string, unknown>>) {
			liveWidth = width;
			await act(async () => root.render(<ThemeProvider theme={resolveSkinTheme('default', theme)}>
				<AudacityWaveformCanvases rootRef={rootRef} clips={[{ ...clip, ...fields }]}
					displayMode={mode} pixelsPerSecond={width} timeSelection={null}
					showRms={false} halfWave={false} verticalZoom={0} channelHeightRatio={0.5}
					spectrogramOptions={{ scale: 'linear', minFreq: 0, maxFreq: FRAME_COUNT / 2,
						fftWindowSize: 256, windowType: 'hann', gainDb: 0, rangeDb: 80, sampleRate: FRAME_COUNT }} />
			</ThemeProvider>));
			if (mode !== 'waveform') {
				await act(async () => { await import('../src/common/editor/ui/timeline/frequency-waveform-renderer.ts'); });
			}
		},
		assertFilledWithoutContours(stage: string) {
			assert.equal(canvas.dataset.waveformError, undefined, stage);
			assert.equal(canvas.dataset.frequencyWaveformMode, mode === 'waveform' ? undefined : mode,
				`${stage}: exercise the actual frequency painter, including its retained projection`);
			// The zero line is legitimate. Anything following the varying upper or
			// lower envelope would be the contour artifact, regardless of its color.
			assert.ok(strokes.every((stroke) => stroke.length === 2
				&& stroke[0]?.[0] === 0 && stroke[1]?.[0] === liveWidth
				&& stroke.every((point) => point[1] === HEIGHT / 2)),
			`${stage}: a summary preview may stroke only the true channel zero line`);
			assert.equal(canvas.dataset.waveformMode, 'summary', stage);
			const filledColumns = new Set(fills.filter((fill) => fill.color !== 'transparent' && fill.alpha > 0 && fill.height > 2
				&& fill.y < HEIGHT / 2 - 2 && fill.y + fill.height > HEIGHT / 2 + 2)
				.map((fill) => Math.floor(fill.x)));
			assert.equal(filledColumns.size, Math.ceil(liveWidth),
				`${stage}: nonzero audio must occupy off-center pixels across the full canvas`);
		},
		async dispose() {
			await act(async () => root.unmount());
			for (const [key, descriptor] of restoredGlobals) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
			dom.restore();
		},
	};
}
