/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNoiseGateProcessor } from '../src/common/editor/first-party-effects/standard/noise-gate-dsp.ts';

const sampleRate = 48_000;
type Processor = ReturnType<typeof createNoiseGateProcessor>;

function render(processor: Processor, values: readonly number[], frames: number, block = 128): Float32Array[] {
	const input = values.map(value => new Float32Array(frames).fill(value));
	const output = values.map(() => new Float32Array(frames));
	for (let offset = 0; offset < frames; offset += block) {
		const count = Math.min(block, frames - offset);
		processor.processBlock(input.map(channel => channel.subarray(offset, offset + count)),
			output.map(channel => channel.subarray(offset, offset + count)), count);
	}
	return output;
}

for (const rangeDb of [-60, -24, -6]) {
	for (const stereoLink of ['linked', 'independent']) {
		test(`raising a closed ${stereoLink} Noise gate floor to ${rangeDb} dB does not open it`, () => {
			const values = [.1, .01];
			const params = { threshold: -6, rangeDb: -80, attack: .001, lookahead: .01,
				hold: 0, release: 4, stereoLink };
			const processor = createNoiseGateProcessor({ sampleRate, channelCount: 2, params });
			const before = render(processor, values, 1024);
			assert.equal(before[0][1023], Math.fround(Math.fround(values[0]) * 10 ** (-80 / 20)));
			processor.updateParams({ rangeDb });
			const after = render(processor, values, 4096);
			const floor = 10 ** (rangeDb / 20);
			for (const [channel, samples] of after.entries()) {
				assert.ok(samples.every(sample => sample <= Math.fround(Math.fround(values[channel]) * floor)),
					'A below-threshold recording must never become louder than its authored closed-gate floor.');
				assert.equal(samples[48], Math.fround(Math.fround(values[channel]) * floor),
					'The accepted floor must finish opening at the supported one-millisecond attack.');
			}
		});
	}
}

test('floor changes preserve actual opening, hold and subsequent closed-gate release', () => {
	const params = { threshold: -20, rangeDb: -80, attack: .001, lookahead: 0, hold: .01, release: .01 };
	const processor = createNoiseGateProcessor({ sampleRate, channelCount: 1, params });
	render(processor, [.2], 1024);
	processor.updateParams({ rangeDb: -24 });
	const held = render(processor, [.01], 480);
	assert.ok(held[0].every(sample => sample === Math.fround(.01)));
	const release = render(processor, [.01], 4800);
	assert.ok(release[0][0] < .01 && release[0][0] > .0006);
	assert.ok(release[0][4799] > .0006 && release[0][4799] < .00064);
});

test('a closed floor edit is invariant under ordinary audio block boundaries', () => {
	const params = { threshold: -6, rangeDb: -80, attack: .001, lookahead: 0, hold: 0, release: 4 };
	const whole = createNoiseGateProcessor({ sampleRate, channelCount: 1, params });
	const chunked = createNoiseGateProcessor({ sampleRate, channelCount: 1, params });
	for (const processor of [whole, chunked]) {
		render(processor, [.1], 1024);
		processor.updateParams({ rangeDb: -60 });
	}
	assert.deepEqual(render(chunked, [.1], 4096, 73), render(whole, [.1], 4096, 4096));
});
