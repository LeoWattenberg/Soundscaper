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
