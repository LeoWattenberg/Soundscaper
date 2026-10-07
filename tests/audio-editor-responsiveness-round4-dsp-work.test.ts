/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { BandCompressor } from '../src/common/editor/first-party-effects/dynamics/core.ts';
import { applyMultibandCompressor, createMultibandCompressorProcessor } from '../src/common/editor/first-party-effects/multiband-compressor/dsp.ts';
import { applyStandardEffect } from '../src/common/editor/first-party-effects/standard/dsp.ts';
import { calculateAudioSpectrum } from '../src/common/editor/audio-spectrum.ts';

function countMathCalls(method: 'abs' | 'exp', run: () => void): number {
	const original = Math[method]; let count = 0;
	Math[method] = (value: number): number => { count++; return original(value); };
	try { run(); } finally { Math[method] = original; }
	return count;
}

test('band compressor retains attack and release design when only gain controls change', () => {
	const compressor = new BandCompressor(48000);
	compressor.configure(-24, 6, .01, .1);
	assert.equal(countMathCalls('exp', () => compressor.configure(-31, 12, .01, .1, 20)), 0);
	assert.equal(countMathCalls('exp', () => compressor.configure(-31, 12, .02, .1, 20)), 1);
	assert.equal(countMathCalls('exp', () => compressor.configure(-31, 12, .02, .2, 20)), 1);
	compressor.gain(1);
	compressor.configure(-31, 1, .02, .2);
	assert.equal(compressor.gain(1), 1, 'neutral configure still clears reduction');
});

test('offline multiband selection omits unconsumed peak telemetry while live telemetry remains', () => {
	const input = [Float32Array.from({ length: 2049 }, (_, index) => Math.sin(index * .071))];
	assert.equal(countMathCalls('abs', () => { applyMultibandCompressor(input, 8000); }), 0);
	const processor = createMultibandCompressorProcessor({ sampleRate: 8000, channelCount: 1 });
	const output = [new Float32Array(input[0]!.length)];
	assert.equal(countMathCalls('abs', () => processor.processBlock(input, output, input[0]!.length)), input[0]!.length * 2);
	assert.equal(processor.readAnalysis()?.frames, input[0]!.length);
	assert.equal(processor.readAnalysis(), null);
});

test('zero-latency standard selections allocate no unused zero input blocks', () => {
	const input = [new Float32Array(2049), new Float32Array(2049)];
	const original = globalThis.Float32Array; const sizes: number[] = [];
	globalThis.Float32Array = new Proxy(original, { construct(target, args: unknown[]) {
		if (typeof args[0] === 'number') sizes.push(args[0]);
		return Reflect.construct(target, args) as Float32Array;
	} });
	try { applyStandardEffect('lowpass-filter', input, 8000); } finally { globalThis.Float32Array = original; }
	assert.deepEqual(sizes, [2049, 2049, 1024, 1024]);
});

test('full standard output blocks do not allocate typed subarray wrappers', () => {
	const input = [new Float32Array(2049)];
	const original = Float32Array.prototype.subarray;
	let count = 0;
	Float32Array.prototype.subarray = function(start?: number, end?: number) { count++; return original.call(this, start, end); };
	try { applyStandardEffect('lowpass-filter', input, 8000); } finally { Float32Array.prototype.subarray = original; }
	assert.equal(count, 4, 'three input views and only the final partial output view');
});

test('synchronous spectrum workspaces are reused without retaining or aliasing caller PCM', () => {
	const input = [Float32Array.from({ length: 211 }, (_, index) => Math.sin(index))];
	const first = calculateAudioSpectrum(input, 8000, { size: 256 });
	const original = globalThis.Float64Array; let count = 0;
	globalThis.Float64Array = new Proxy(original, { construct(target, args: unknown[]) { count++; return Reflect.construct(target, args) as Float64Array; } });
	let second: ReturnType<typeof calculateAudioSpectrum>;
	try { second = calculateAudioSpectrum(input, 8000, { size: 256 }); } finally { globalThis.Float64Array = original; }
	assert.equal(count, 0);
	assert.deepEqual(second, first);
	input[0]!.fill(0);
	const silent = calculateAudioSpectrum(input, 8000, { size: 256 });
	assert.ok(silent.bins.every(bin => bin.amplitude === 0));
	assert.ok(first.bins.some(bin => bin.amplitude > 0));
});
