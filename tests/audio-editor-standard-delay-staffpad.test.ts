/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadStaffPadWasm } from '../src/common/editor/staffpad/runtime.js';
import { createStandardDelayProcessor } from '../src/common/editor/first-party-effects/standard/delay-dsp.ts';
import { standardDelayLatencyFrames } from '../src/common/editor/first-party-effects/standard/delay-definition.ts';

const sampleRate = 8000;
async function runtime() {
	return loadStaffPadWasm(await readFile(new URL('../src/common/editor/staffpad/staffpad.wasm', import.meta.url)));
}

test('pitched delay requires StaffPad instead of silently substituting a delay-head algorithm', () => {
	assert.throws(() => createStandardDelayProcessor({ sampleRate, channelCount: 1,
		params: { pitchShift: 2 } }), /StaffPad/);
});

test('StaffPad delay retains pitch, stereo geometry and deterministic stream partitions', async () => {
	const input = Float32Array.from({ length: 16000 }, (_, frame) => .2 * Math.sin(2 * Math.PI * 200 * frame / sampleRate));
	const params = { time: .1, echoes: 2, echoGain: -6, pitchShift: 2 };
	const options = { sampleRate, channelCount: 2, params, staffPadRuntime: await runtime() };
	function render(block: number) {
		const processor = createStandardDelayProcessor(options);
		const output = [new Float32Array(input.length), new Float32Array(input.length)];
		for (let offset = 0; offset < input.length; offset += block) {
			const end = Math.min(input.length, offset + block);
			processor.processBlock([input.subarray(offset, end), input.subarray(offset, end)],
				output.map(channel => channel.subarray(offset, end)), end - offset);
		}
		assert.equal(processor.latencyFrames, standardDelayLatencyFrames(params, sampleRate));
		processor.dispose();
		return output;
	}
	const full = render(input.length);
	assert.deepEqual(render(73), full);
	assert.deepEqual(full[0], full[1]);
	const latency = standardDelayLatencyFrames(params, sampleRate);
	function amplitude(frequency: number) {
		let real = 0;
		let imaginary = 0;
		for (let frame = 8000; frame < 15000; frame++) {
			const echo = full[0][frame] - input[frame - latency];
			const angle = 2 * Math.PI * frequency * frame / sampleRate;
			real += echo * Math.cos(angle);
			imaginary += echo * Math.sin(angle);
		}
		return Math.hypot(real, imaginary) / 7000;
	}
	assert.ok(amplitude(200 * 2 ** (2 / 12)) > .025);
	assert.ok(amplitude(200 * 2 ** (4 / 12)) > .01);
	assert.ok(amplitude(200) < .005);
});
