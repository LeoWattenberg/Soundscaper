/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	drawFrequencyWaveformChannel,
	drawRainbowWaveformChannel,
	drawThreeBandWaveformChannel,
} from '../src/common/editor/ui/timeline/frequency-waveform-renderer.ts';

function summary(values: readonly number[]) {
	return {
		mode: 'summary',
		pixelWidth: values.length,
		pixelsPerSample: 0.1,
		startFrame: 0,
		endFrame: values.length,
		frameCount: values.length,
		channels: [{
			minimum: Float32Array.from(values, (value) => -value),
			maximum: Float32Array.from(values),
			rms: Float32Array.from(values, (value) => value / 2),
		}],
	};
}

function recordingContext() {
	const fills: Array<Readonly<{ color: string; alpha: number }>> = [];
	const strokes: string[] = [];
	let fillStyle = '';
	let strokeStyle = '';
	let globalAlpha = 1;
	return {
		fills,
		strokes,
		save() {},
		restore() {},
		beginPath() {},
		moveTo() {},
		lineTo() {},
		stroke() { strokes.push(strokeStyle); },
		fillRect() { fills.push({ color: fillStyle, alpha: globalAlpha }); },
		set fillStyle(value: string) { fillStyle = value; },
		get fillStyle() { return fillStyle; },
		set strokeStyle(value: string) { strokeStyle = value; },
		get strokeStyle() { return strokeStyle; },
		set globalAlpha(value: number) { globalAlpha = value; },
		get globalAlpha() { return globalAlpha; },
	};
}

const drawing = {
	channel: 0,
	width: 2,
	pixelRatioX: 1,
	centerY: 20,
	maxAmplitude: 18,
	halfWave: false,
	centerLineColor: '#divider',
};

const lightStyle = { colorScheme: 'light', getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;

test('three-band yields to ordinary sample rendering at both sample zoom thresholds', () => {
	for (const mode of ['connecting-dots', 'stem']) {
		const context = recordingContext();
		const rendering = { ...summary([1, 1]), mode };
		const projection = {
			sampleRate: 48_000, peakBlockSize: 256,
			bands: { low: summary([1, 1]), mid: summary([1, 1]), high: summary([1, 1]) },
			centroidHz: Float32Array.of(100, 22_050), centroidWeight: Float32Array.of(1, 1),
		};
		assert.equal(drawFrequencyWaveformChannel(context as unknown as CanvasRenderingContext2D,
			'waveform-three-band', rendering, projection, drawing, lightStyle, true), false);
		assert.equal(context.fills.length, 0);
	}
});

test('three-band RMS uses the full-band summary when enabled', () => {
	const context = recordingContext();
	const rendering = summary([1, 1]);
	const projection = {
		sampleRate: 48_000, peakBlockSize: 256,
		bands: { low: rendering, mid: rendering, high: rendering },
		centroidHz: Float32Array.of(100, 22_050), centroidWeight: Float32Array.of(1, 1),
	};
	assert.equal(drawFrequencyWaveformChannel(context as unknown as CanvasRenderingContext2D,
		'waveform-three-band', rendering, projection, drawing, lightStyle, true), true);
	assert.ok(context.fills.some(({ color }) => color === 'rgba(0, 0, 0, 0.28)'));
});

test('three-band renderer overlays low, mid, and high without RMS recoloring', () => {
	const context = recordingContext();
	const plan = {
		sampleRate: 48_000,
		peakBlockSize: 256,
		bands: {
			low: summary([0.25, 0.5]),
			mid: summary([0.5, 0.75]),
			high: summary([0.75, 1]),
		},
		centroidHz: Float32Array.of(100, 22_050),
		centroidWeight: Float32Array.of(1, 1),
	};

	drawThreeBandWaveformChannel(context as unknown as CanvasRenderingContext2D, plan, {
		...drawing,
		colors: { low: '#low', mid: '#mid', high: '#high' },
		opacity: 0.72,
	});

	assert.deepEqual(new Set(context.fills.map(({ color }) => color)), new Set(['#low', '#mid', '#high']));
	assert.ok(context.fills.every(({ alpha }) => alpha === 0.72));
	assert.equal(context.fills.length, 6, 'one peak span per band and column, with no RMS pass');
	assert.deepEqual(context.strokes, ['#divider'], 'the shared center line is painted once');
});

test('rainbow renderer colors both peak and RMS spans from each centroid column', () => {
	const context = recordingContext();
	const plan = {
		sampleRate: 48_000,
		peakBlockSize: 256,
		bands: { low: summary([1, 1]), mid: summary([1, 1]), high: summary([1, 1]) },
		centroidHz: Float32Array.of(100, 22_050),
		centroidWeight: Float32Array.of(1, 1),
	};

	drawRainbowWaveformChannel(
		context as unknown as CanvasRenderingContext2D,
		summary([1, 1]),
		plan,
		{ ...drawing, showRms: true },
	);

	assert.deepEqual(context.fills.map(({ color }) => color), [
		'rgb(99, 80, 155)',
		'rgb(71, 58, 112)',
		'rgb(176, 76, 69)',
		'rgb(127, 55, 50)',
	]);
	assert.notEqual(context.fills[0]?.color, context.fills[1]?.color, 'RMS remains visible inside each peak span');
	assert.deepEqual(context.strokes, ['#divider']);
});
