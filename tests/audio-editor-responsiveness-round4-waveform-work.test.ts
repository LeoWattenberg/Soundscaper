/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { FrequencyWaveformAnalyzer } from '../src/common/editor/frequency-waveform-analysis.ts';

function analyzer(frames = 4097): FrequencyWaveformAnalyzer {
	return new FrequencyWaveformAnalyzer({ sampleRate: 8000, frameCount: frames, channelCount: 2 }, (real, imaginary) => {
		for (let index = 0; index < real.length; index++) { real[index] *= .7; imaginary[index] = real[index]! * .13; }
	});
}

test('frequency analysis accumulates rounded band peaks without full chunk PCM intermediates', () => {
	const input = [new Float32Array(4097), new Float32Array(4097)]; const owner = analyzer();
	const original = globalThis.Float32Array; let count = 0;
	globalThis.Float32Array = new Proxy(original, { construct(target, args: unknown[]) { count++; return Reflect.construct(target, args) as Float32Array; } });
	try { owner.push(input); } finally { globalThis.Float32Array = original; }
	assert.equal(count, 0);
	const output = owner.finish();
	assert.ok(output.levels[0]!.bands.low.every(channel => channel.minimums.every(value => value === 0)));
});

test('centroid history uses circular ownership without copying retained halves or clearing overwritten tails', () => {
	const owner = analyzer(); const input = [new Float32Array(4097), new Float32Array(4097)];
	const copy = Float32Array.prototype.copyWithin; const fill = Float32Array.prototype.fill;
	let copies = 0; let tailClears = 0;
	Float32Array.prototype.copyWithin = function(target: number, start: number, end?: number) { copies++; return copy.call(this, target, start, end); };
	Float32Array.prototype.fill = function(value: number, start?: number, end?: number) { if (start !== undefined && start > 0) tailClears++; return fill.call(this, value, start, end); };
	try { owner.push(input); owner.finish(); } finally { Float32Array.prototype.copyWithin = copy; Float32Array.prototype.fill = fill; }
	assert.equal(copies, 0);
	assert.equal(tailClears, 0);
});

test('split-band peak bucket geometry is shared across every band and channel', () => {
	const samples = [Float32Array.from({ length: 511 }, (_, index) => Math.sin(index)), new Float32Array(511)];
	const owner = analyzer(511);
	const original = Math.floor; let divisions = 0;
	Math.floor = (value: number): number => { divisions++; return original(value); };
	try { owner.push(samples); } finally { Math.floor = original; }
	assert.equal(divisions, 1, 'one initial bucket division, then integer boundary advances');
});
