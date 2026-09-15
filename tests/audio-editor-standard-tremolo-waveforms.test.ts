/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTremoloProcessor } from '../src/common/editor/first-party-effects/standard/tremolo-dsp.ts';

const SAMPLE_RATE = 48_000;

function modulation(waveform: string, frequency = 4, phase = 0): Float32Array {
	const frames = Math.ceil(SAMPLE_RATE / frequency);
	const input = new Float32Array(frames).fill(1);
	const output = new Float32Array(frames);
	createTremoloProcessor({ sampleRate: SAMPLE_RATE, channelCount: 1,
		params: { waveform, frequency, phase, depth: 100 } }).processBlock([input], [output], frames);
	return output;
}

function near(actual: number, expected: number): void {
	assert.ok(Math.abs(actual - expected) < .00001, `${String(actual)} should be ${String(expected)}`);
}

test('tremolo sawtooth and inverse sawtooth match the Nyquist tables with a half percent return ramp', () => {
	for (const frequency of [4, 40]) {
		const sawtooth = modulation('sawtooth', frequency);
		const inverse = modulation('inverse-sawtooth', frequency);
		const at = (phase: number): number => Math.round(phase * SAMPLE_RATE / frequency);
		near(sawtooth[0], 0);
		near(sawtooth[at(.4975)], .5);
		near(sawtooth[at(.995)], 1);
		near(sawtooth[at(.9975)], .5);
		near(inverse[0], 0);
		near(inverse[at(.0025)], .5);
		near(inverse[at(.005)], 1);
		near(inverse[at(.5025)], .5);
	}
});

test('tremolo square rises immediately through its short ramp and falls through a ramp halfway through the cycle', () => {
	const output = modulation('square');
	for (const [frame, gain] of [[0, 0], [30, .5], [60, 1], [3000, 1], [6000, 1], [6030, .5], [6060, 0], [9000, 0]]) {
		near(output[frame], gain);
	}
});

test('the starting phase uses the same phase orientation for every tremolo waveform', () => {
	near(modulation('sine', 4, 0)[0], 0);
	near(modulation('sine', 4, 90)[0], .5);
	near(modulation('triangle', 4, 90)[0], .5);
	near(modulation('square', 4, 90)[0], 1);
	near(modulation('square', 4, -90)[0], 0);
	near(modulation('inverse-sawtooth', 4, 0)[0], 0);
	near(modulation('inverse-sawtooth', 4, 180)[0], .5 / .995);
});
