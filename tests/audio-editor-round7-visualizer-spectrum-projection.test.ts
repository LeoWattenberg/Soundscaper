/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';
import { renderSoundVisualizerRgba } from '../src/common/editor/sound-visualizer-rgba.ts';

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 1_024;

function tone(bin: number): Float32Array {
	return Float32Array.from({ length: FFT_SIZE }, (_, frame) =>
		0.5 * Math.sin(2 * Math.PI * bin * frame / FFT_SIZE));
}

function peakRow(channel: Float32Array, width: number): number {
	const frame = renderSoundVisualizerRgba({
		mode: 'spectrum', channels: [channel], sampleRate: SAMPLE_RATE,
		windowStartFrame: 0, timelineFrame: 0, width, height: 100,
		foregroundColor: '#ff0000ff', backgroundColor: '#000000ff',
	});
	for (let y = 0; y < frame.height; y += 1) {
		for (let x = 1; x < frame.width; x += 1) {
			const offset = (y * frame.width + x) * 4;
			if (frame.pixels[offset] === 255 && frame.pixels[offset + 1] === 0
				&& frame.pixels[offset + 2] === 0 && frame.pixels[offset + 3] === 255) return y;
		}
	}
	throw new Error('The visualizer did not paint its foreground curve.');
}

test('an ordinary low-frequency reference retains its calibrated visualizer peak', () => {
	const channel = tone(10);
	const spectrum = calculateAudioSpectrum([channel], SAMPLE_RATE, { size: FFT_SIZE });
	assert.ok(Math.abs(spectrum.bins[10]!.amplitude - 0.5) < 0.001);
	assert.ok(peakRow(channel, 1_280) <= 1);
});

for (const [width, bin] of [[640, 300], [720, 373], [1_280, 300], [1_920, 318]] as const) {
	test(`the ${width}-pixel visualizer preserves a normal ${bin * SAMPLE_RATE / FFT_SIZE} Hz recording peak`, () => {
		const channel = tone(bin);
		const spectrum = calculateAudioSpectrum([channel], SAMPLE_RATE, { size: FFT_SIZE });
		assert.ok(Math.abs(spectrum.bins[bin]!.amplitude - 0.5) < 0.001,
			'the actual calibrated FFT must contain the healthy tone before projection');
		assert.ok(peakRow(channel, width) <= 1,
			'equal-amplitude high and low tones must reach the same spectrum ceiling');
	});
}
