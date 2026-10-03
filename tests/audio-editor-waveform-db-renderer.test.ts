/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { drawAudacityWaveformChannel } from '../src/common/editor/audacity-waveform-renderer.js';

type Point = readonly [number, number];
type Span = Readonly<{ x: number; y: number; width: number; height: number }>;

function recordingContext() {
	const fills: Span[] = [];
	const strokes: Point[][] = [];
	const heads: Point[] = [];
	let path: Point[] = [];
	return {
		fills, strokes, heads,
		beginPath() { path = []; },
		moveTo(x: number, y: number) { path.push([x, y]); },
		lineTo(x: number, y: number) { path.push([x, y]); },
		stroke() { strokes.push(path); },
		arc(x: number, y: number) { heads.push([x, y]); },
		fill() {},
		fillRect(x: number, y: number, width: number, height: number) {
			fills.push({ x, y, width, height });
		},
	};
}

function summary(minimum: number[], maximum: number[], rms?: number[]) {
	return {
		mode: 'summary', pixelWidth: minimum.length, pixelsPerSample: 0.1,
		channels: [{ minimum, maximum, rms }],
	};
}

const drawing = { centerY: 50, maxAmplitude: 30, amplitudeScale: 'db' };

test('dB summaries map peak and RMS magnitudes from -60 dB to full scale', () => {
	const context = recordingContext();
	drawAudacityWaveformChannel(context, summary(
		[-0.1, -0.01, 0, -1], [0.1, 0.01, 0, 1], [0.01, 0.001, 0, 1],
	), { ...drawing, width: 4, showRms: true });
	assert.deepEqual(context.fills, [
		{ x: 0, y: 30, width: 1, height: 40 },
		{ x: 0, y: 40, width: 1, height: 20 },
		{ x: 1, y: 40, width: 1, height: 20 },
		{ x: 1, y: 50, width: 1, height: 1 },
		{ x: 2, y: 50, width: 1, height: 1 },
		{ x: 2, y: 50, width: 1, height: 1 },
		{ x: 3, y: 20, width: 1, height: 60 },
		{ x: 3, y: 20, width: 1, height: 60 },
	]);
});

test('dB summaries apply gain before scaling and RMS stays inside the peak span', () => {
	const context = recordingContext();
	drawAudacityWaveformChannel(context, summary(
		[-0.1, 0.01], [0.1, 0.1], [0.01, 0.03],
	), { ...drawing, width: 2, showRms: true, envelopeGain: () => 0.1 });
	assert.deepEqual(context.fills.slice(0, 2), [
		{ x: 0, y: 40, width: 1, height: 20 },
		{ x: 0, y: 50, width: 1, height: 1 },
	]);
	const peak = context.fills[2];
	const rms = context.fills[3];
	assert.ok(peak && rms);
	assert.equal(peak.y, 40);
	assert.equal(peak.height, 10);
	assert.ok(rms.y >= peak.y && rms.y + rms.height <= peak.y + peak.height);
});

test('dB summary RMS combines source column energy before its logarithmic mapping', () => {
	const context = recordingContext();
	drawAudacityWaveformChannel(context, summary([-1, -1], [1, 1], [0.001, 0.1]), {
		...drawing, width: 1, showRms: true,
	});
	assert.deepEqual(context.fills[1], { x: 0, y: 32, width: 1, height: 36 });
});

test('dB half-wave summaries expand positive values and remove negative values', () => {
	const context = recordingContext();
	drawAudacityWaveformChannel(context, summary([-0.1, -1], [0.1, -0.01], [0.01, 0.1]), {
		...drawing, width: 2, centerY: 80, maxAmplitude: 60, halfWave: true, showRms: true,
	});
	assert.deepEqual(context.fills, [
		{ x: 0, y: 40, width: 1, height: 40 },
		{ x: 0, y: 60, width: 1, height: 20 },
		{ x: 1, y: 80, width: 1, height: 1 },
		{ x: 1, y: 80, width: 1, height: 1 },
	]);
});

test('dB summary silence and muted gain stay on the center line', () => {
	for (const envelopeGain of [() => 0, () => 1]) {
		const context = recordingContext();
		const peak = envelopeGain() ? 0.0001 : 1;
		drawAudacityWaveformChannel(context, summary([-peak], [peak], [peak]), {
			...drawing, width: 1, showRms: true, envelopeGain,
		});
		assert.ok(context.fills.every(({ y, height }) => y === 50 && height === 1));
	}
});

test('dB connecting dots and stems apply the same signed scale after gain', () => {
	for (const mode of ['connecting-dots', 'stem']) {
		const context = recordingContext();
		drawAudacityWaveformChannel(context, {
			mode, pixelWidth: 12, pixelsPerSample: 4,
			channels: [{ firstSampleX: 0, samples: [1, 0.1, -0.1, 0] }],
		}, { ...drawing, width: 12, envelopeGain: () => 0.1 });
		const points = mode === 'stem' ? context.heads : [
			context.strokes[0]?.[0], ...context.strokes.map((path) => path[1]),
		];
		assert.ok(points.every(Boolean));
		for (const [index, point] of points.entries()) {
			assert.ok(point);
			assert.equal(point[0], index * 4);
			assert.ok(Math.abs(point[1] - [30, 40, 60, 50][index]!) < 1e-8);
		}
	}
});

test('dB sample heads keep silence, full scale and over-unity amplitudes distinct', () => {
	const context = recordingContext();
	drawAudacityWaveformChannel(context, {
		mode: 'stem', pixelWidth: 24, pixelsPerSample: 4,
		channels: [{ firstSampleX: 0, samples: [0, 0.001, 0.0001, 1, -1, 2, -2] }],
	}, { ...drawing, width: 24 });
	assert.deepEqual(context.heads.slice(0, 5), [[0, 50], [4, 50], [8, 50], [12, 20], [16, 80]]);
	assert.ok(context.heads[5]![1] < 20);
	assert.ok(context.heads[6]![1] > 80);
});

test('dB sample half-wave rendering places negative samples on the center line', () => {
	const context = recordingContext();
	drawAudacityWaveformChannel(context, {
		mode: 'stem', pixelWidth: 8, pixelsPerSample: 4,
		channels: [{ firstSampleX: 0, samples: [-0.1, 0, 0.01] }],
	}, { ...drawing, width: 8, centerY: 80, maxAmplitude: 60, halfWave: true });
	assert.deepEqual(context.heads, [[0, 80], [4, 80], [8, 60]]);
});

test('omitted amplitude scale retains the existing linear rendering', () => {
	const rendering = summary([-0.1], [0.1], [0.01]);
	const inherited = recordingContext();
	const linear = recordingContext();
	for (const [context, amplitudeScale] of [[inherited, undefined], [linear, 'linear']] as const) {
		drawAudacityWaveformChannel(context, rendering, {
			width: 1, centerY: 50, maxAmplitude: 30, showRms: true, amplitudeScale,
		});
	}
	assert.deepEqual(inherited.fills, linear.fills);
	assert.deepEqual(inherited.fills[0], { x: 0, y: 47, width: 1, height: 6 });
});
