/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSoundVisualizerRgba } from '../src/common/editor/sound-visualizer-rgba.ts';
import { SOUND_VISUALIZER_SPECTRUM_SIZE, soundVisualizerSpectrumWindowStarts,
} from '../src/common/editor/sound-visualizer-spectrum-windows.ts';

const base = {
	mode: 'waveform' as const,
	sampleRate: 1_024,
	windowStartFrame: 0,
	timelineFrame: 0,
	width: 32,
	height: 24,
	foregroundColor: '#66d3c5ff',
	backgroundColor: '#000000ff',
};

function pixel(pixels: Uint8Array, width: number, x: number, y: number): number[] {
	return Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
}

function foregroundCount(pixels: Uint8Array, width: number, x: number): number {
	let count = 0;
	for (let y = 0; y < pixels.length / width / 4; y += 1) {
		const offset = (y * width + x) * 4;
		if (pixels[offset] === 0x66 && pixels[offset + 1] === 0xd3
			&& pixels[offset + 2] === 0xc5 && pixels[offset + 3] === 0xff) count += 1;
	}
	return count;
}

test('a silent waveform still animates with the output frame', () => {
	const channels = [new Float32Array(1_024)];
	const first = renderSoundVisualizerRgba({ ...base, channels });
	const next = renderSoundVisualizerRgba({ ...base, channels, timelineFrame: 1 });
	assert.equal(first.pixels.length, base.width * base.height * 4);
	assert.notDeepEqual(first.pixels, next.pixels);
	assert.deepEqual(first.pixels, renderSoundVisualizerRgba({ ...base, channels }).pixels);
});

test('a waveform renders the changing sample envelope', () => {
	const silence = renderSoundVisualizerRgba({ ...base, channels: [new Float32Array(1_024)] });
	const alternating = Float32Array.from({ length: 1_024 }, (_, frame) => frame % 2 ? 0.8 : -0.8);
	const active = renderSoundVisualizerRgba({ ...base, channels: [alternating] });
	assert.ok(foregroundCount(active.pixels, base.width, 10) > foregroundCount(silence.pixels, base.width, 10) + 8);
});

test('the spectrum follows the existing FFT rather than a fixed picture', () => {
	// A 1,024-point FFT at 1,024 Hz puts these tones in bins 16 and 128.
	// With 37 logarithmic columns, those powers of two land at x=16 and x=28.
	const width = 37;
	const foreground = [102, 211, 197, 255];
	const background = [0, 0, 0, 255];
	const sine = Float32Array.from({ length: 1_024 }, (_, frame) => Math.sin(2 * Math.PI * 128 * frame / 1_024));
	const input = { ...base, mode: 'spectrum' as const, width };
	const signal = renderSoundVisualizerRgba({ ...input, channels: [sine] });
	const silent = renderSoundVisualizerRgba({ ...input, channels: [new Float32Array(1_024)] });
	assert.notDeepEqual(signal.pixels, silent.pixels);
	assert.notDeepEqual(signal.pixels, renderSoundVisualizerRgba({ ...input, channels: [sine], timelineFrame: 1 }).pixels);
	assert.deepEqual(pixel(signal.pixels, width, 28, 0), foreground);
	assert.deepEqual(pixel(signal.pixels, width, 16, 0), background);
	const lowerSine = Float32Array.from({ length: 1_024 }, (_, frame) => Math.sin(2 * Math.PI * 16 * frame / 1_024));
	const lower = renderSoundVisualizerRgba({ ...input, channels: [lowerSine] });
	assert.deepEqual(pixel(lower.pixels, width, 16, 0), foreground);
	assert.deepEqual(pixel(lower.pixels, width, 28, 0), background);
});

test('packed spectrum snapshots render the same temporal average as a full window', () => {
	const full = Float32Array.from({ length: 2_000 }, (_, frame) => frame >= 256 && frame < 512
		? Math.sin(2 * Math.PI * 128 * frame / 1_024) : 0);
	const packed = new Float32Array(2_048);
	packed.set(full.subarray(0, 1_024), 0);
	packed.set(full.subarray(976), 1_024);
	const input = { ...base, mode: 'spectrum' as const };
	assert.deepEqual(renderSoundVisualizerRgba({ ...input, channels: [packed] }).pixels,
		renderSoundVisualizerRgba({ ...input, channels: [full] }).pixels);
});

test('spectrum FFT snapshots stay evenly spaced and include the view center', () => {
	for (const frameCount of [1_025, 2_048, 4_095, 8_192, 8_193, 10_000, 960_001]) {
		const starts = soundVisualizerSpectrumWindowStarts(frameCount);
		const center = Math.floor(frameCount / 2);
		assert.ok(starts.length <= 9);
		assert.equal(starts[0], 0);
		assert.equal(starts.at(-1), frameCount - SOUND_VISUALIZER_SPECTRUM_SIZE);
		assert.ok(starts.some((start) => start <= center
			&& center < start + SOUND_VISUALIZER_SPECTRUM_SIZE), `${frameCount} misses its center`);
		const gaps = starts.slice(1).map((start, index) => start - starts[index]!);
		assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1);
	}
	const longStarts = soundVisualizerSpectrumWindowStarts(10_000);
	assert.equal(longStarts.length, 9);
	assert.equal(longStarts[4], 4_488);
});

test('missing audio draws an animated idle marker over the chosen background', () => {
	const input = { ...base, channels: null, backgroundColor: '#01020304' };
	const first = renderSoundVisualizerRgba(input);
	const next = renderSoundVisualizerRgba({ ...input, timelineFrame: 1 });
	assert.deepEqual(pixel(first.pixels, base.width, 8, 0), [1, 2, 3, 4]);
	assert.notDeepEqual(first.pixels, next.pixels);
});

test('a window may begin before timeline zero and retain its leading silence', () => {
	const frame = renderSoundVisualizerRgba({ ...base, windowStartFrame: -512,
		channels: [new Float32Array(1_024)] });
	assert.equal(frame.pixels.length, base.width * base.height * 4);
});

test('invalid geometry, PCM, and colors are rejected', () => {
	assert.throws(() => renderSoundVisualizerRgba({ ...base, channels: null, width: 0 }), /width/u);
	assert.throws(() => renderSoundVisualizerRgba({ ...base, channels: null, height: 100_000 }), /height/u);
	assert.throws(() => renderSoundVisualizerRgba({ ...base, channels: null, timelineFrame: -1 }), /timelineFrame/u);
	assert.throws(() => renderSoundVisualizerRgba({ ...base, channels: null, foregroundColor: '#abc' }), /foregroundColor/u);
	assert.throws(() => renderSoundVisualizerRgba({ ...base, channels: [new Float32Array(2), new Float32Array(3)] }), /equal lengths/u);
});
