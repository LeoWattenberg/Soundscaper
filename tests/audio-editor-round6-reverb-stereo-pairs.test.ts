/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';

import { ReverbLiveProcessor } from '../src/common/editor/audacity-effects/reverb-live-processor.js';

const RATE = 8_000;
const PARAMS = { preDelay: 0, wetOnly: true, wetGainDb: 0, stereoWidth: 0 };

function tone(channelCount: number, active = 0): Float32Array[] {
	return Array.from({ length: channelCount }, (_, channel) => Float32Array.from(
		{ length: RATE }, (_, frame) => channel === active ? .25 * Math.sin(2 * Math.PI * 440 * frame / RATE) : 0,
	));
}

function reverb(input: Float32Array[], params = PARAMS): Float32Array[] {
	const output = input.map(channel => new Float32Array(channel.length));
	new ReverbLiveProcessor(RATE, params).process(input, output);
	return output;
}

function expectExactPcm(actual: readonly Float32Array[], expected: readonly Float32Array[]): void {
	assert.equal(actual.length, expected.length);
	for (const [channel, samples] of actual.entries()) {
		const reference = expected[channel]!;
		assert.ok(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
			.equals(Buffer.from(reference.buffer, reference.byteOffset, reference.byteLength)),
		`Channel ${channel} must retain every exact Float32 word.`);
	}
}

test('quad reverb preserves the healthy front stereo pair when padding with silent rear channels', () => {
	const stereo = reverb(tone(2));
	expectExactPcm([stereo[0]], [stereo[1]]);
	assert.ok(stereo[0].some(sample => Math.abs(sample) > .01));
	const quad = reverb(tone(4));
	expectExactPcm(quad.slice(0, 2), stereo);
});

test('quad reverb does not send the front pair wet signal to a silent rear pair', () => {
	const quad = reverb(tone(4));
	assert.ok(quad.slice(2).every(channel => channel.every(sample => sample === 0)));
});

test('quad reverb closes its rear stereo pair without leaking into the front pair', () => {
	const quad = reverb(tone(4, 2));
	assert.ok(quad.slice(0, 2).every(channel => channel.every(sample => sample === 0)));
	expectExactPcm([quad[2]], [quad[3]]);
	assert.ok(quad[2].some(sample => Math.abs(sample) > .01));
});

test('an unpaired final reverb channel remains mono instead of wrapping into the first pair', () => {
	const input = tone(3, 2);
	const monoWidth = reverb(input, { ...PARAMS, stereoWidth: 100 });
	assert.ok(monoWidth[2].some(sample => Math.abs(sample) > .01));
	expectExactPcm(reverb(input), monoWidth);
});

test('full stereo width keeps all channels independent at the supported 32-channel geometry', () => {
	const output = reverb(tone(32), { ...PARAMS, stereoWidth: 100 });
	assert.equal(output.length, 32);
	assert.ok(output[0].some(sample => Math.abs(sample) > .01));
	assert.ok(output.slice(1).every(channel => channel.every(sample => sample === 0)));
});
