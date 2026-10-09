/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEbuR128Meter } from '../src/common/editor/ebu-r128.js';

const rate = 48_000;
const shifted = Float32Array.from({ length: rate }, (_, frame) => .6 * Math.sin(Math.PI / 2 * frame + Math.PI / 4));
const aligned = Float32Array.from({ length: rate }, (_, frame) => .6 * Math.sin(Math.PI / 2 * frame));

function peak(channel: Float32Array): number {
	let maximum = 0;
	for (const sample of channel) maximum = Math.max(maximum, Math.abs(sample));
	return maximum;
}

for (const running of [false, true]) for (const frames of [rate, rate + 31]) {
	test(`EBU retains ordinary sample peak with running=${String(running)} and ${frames} frames`, () => {
		const meter = createEbuR128Meter({ sampleRate: rate, channelCount: 1, running });
		meter.push([shifted]);
		if (frames > rate) meter.push([shifted.subarray(0, frames - rate)]);
		const reading = meter.snapshot();
		assert.equal(reading.peak, peak(shifted));
		assert.equal(reading.dbfs, 20 * Math.log10(peak(shifted)));
		assert.ok(reading.loudness.truePeakDbtp - reading.dbfs > 2.9, 'true peak retains the intersample peak');
	});
}

test('sample-aligned tones retain their original ordinary level', () => {
	const meter = createEbuR128Meter({ sampleRate: rate, channelCount: 1, running: true });
	meter.push([aligned]);
	assert.equal(meter.snapshot().peak, peak(aligned));
	assert.equal(meter.snapshot().dbfs, 20 * Math.log10(peak(aligned)));
});

test('ordinary sample peak changes preserve the exact true-peak, RMS and loudness results', () => {
	const meter = createEbuR128Meter({ sampleRate: rate, channelCount: 1, running: true });
	meter.push([shifted]);
	const reading = meter.snapshot();
	assert.equal(reading.rms, .42426407337187294);
	assert.equal(reading.loudness.truePeakDbtp, -4.39228386878548);
	assert.equal(reading.loudness.maximumTruePeakDbtp, -4.354326533923766);
	assert.equal(reading.loudness.integratedLufs, -4.13889209827031);
});

test('sample and true-peak channels remain continuous across normal capture blocks', () => {
	const whole = createEbuR128Meter({ sampleRate: rate, channelCount: 2, running: true });
	whole.push([shifted, aligned]);
	const blocked = createEbuR128Meter({ sampleRate: rate, channelCount: 2, running: true });
	for (let offset = 0; offset < rate; offset += 127) {
		blocked.push([shifted.subarray(offset, offset + 127), aligned.subarray(offset, offset + 127)]);
	}
	assert.deepEqual(blocked.snapshot(), whole.snapshot());
});
