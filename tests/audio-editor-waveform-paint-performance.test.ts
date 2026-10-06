/* SPDX-License-Identifier: GPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { drawAudacityWaveformChannel } from '../src/common/editor/audacity-waveform-renderer.js';

function context() {
	const fills: number[][] = [];
	let assignments = 0;
	return { fills, get assignments() { return assignments; },
		fillRect(...geometry: number[]) { fills.push(geometry); },
		set fillStyle(_color: string) { assignments += 1; },
	};
}

const options = { width: 100, centerY: 20, maxAmplitude: 18, sampleColor: '#000', rmsColor: '#666' };

void test('hidden RMS performs no RMS reads and sets an unchanged fill color once', () => {
	let reads = 0;
	const channel = { minimum: [-1], maximum: [1],
		get rms() { reads += 1; return [0.5]; } };
	const canvas = context();
	drawAudacityWaveformChannel(canvas, { mode: 'summary', pixelWidth: 100, channels: [channel] }, options);
	assert.equal(reads, 0);
	assert.equal(canvas.assignments, 1);
	assert.equal(canvas.fills.length, 100);
});

void test('RMS-only painting retains the same extrema clipping and physical boundaries', () => {
	const rendering = { mode: 'summary', pixelWidth: 100,
		channels: [{ minimum: [-0.25], maximum: [0.75], rms: [0.5] }] };
	const both = context();
	const rms = context();
	drawAudacityWaveformChannel(both, rendering, { ...options, showRms: true, pixelRatioX: 1.25 });
	drawAudacityWaveformChannel(rms, rendering, { ...options, showRms: true, drawPeaks: false, pixelRatioX: 1.25 });
	assert.deepEqual(rms.fills, both.fills.filter((_, index) => index % 2 === 1));
	assert.equal(rms.assignments, 1);
});

void test('unprobed recording contexts retain individual sample-stem compositing', () => {
	const canvas = {
		fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {},
		strokes: 0, stroke() { this.strokes += 1; },
	};
	const rendering = { mode: 'stem', pixelWidth: 4_000, pixelsPerSample: 4,
		channels: [{ firstSampleX: 0, samples: new Float32Array(1_000).fill(0.5) }] };
	drawAudacityWaveformChannel(canvas, rendering, { ...options, width: 4_000, centerLineColor: '#777' });
	assert.equal(canvas.strokes, 1_001, 'native raster support must be proved before batching');
	canvas.strokes = 0;
	drawAudacityWaveformChannel(canvas, rendering, { ...options, width: 4_000,
		sampleColor: (x: number) => x < 2_000 ? '#000' : '#fff', centerLineColor: '#777' });
	assert.equal(canvas.strokes, 1_001, 'color runs alone do not prove native compositing');
	canvas.strokes = 0;
	drawAudacityWaveformChannel(canvas, rendering, { ...options, width: 4_000,
		pixelRatioX: 0.25, centerLineColor: '#777' });
	assert.equal(canvas.strokes, 1_001, 'overlapping physical strokes preserve individual compositing');
});
