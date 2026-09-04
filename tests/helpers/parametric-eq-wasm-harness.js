/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
// The pinned parametric EQ WASM module and the JavaScript reference processor its
// suites compare against. Split out of parametric-eq-wasm.test.js so its suites
// can sit in separate files.

import { readFile } from 'node:fs/promises';

export const WASM_URL = new URL(
	'../../src/common/editor/parametric-eq/parametric-eq.wasm',
	import.meta.url,
);

export async function loadRuntime(sampleRate, channelCount) {
	const bytes = await readFile(WASM_URL);
	const { instance } = await WebAssembly.instantiate(bytes, {});
	instance.exports._initialize?.();
	assert.equal(instance.exports.peq_initialize(sampleRate, channelCount), 0);
	return {
		exports: instance.exports,
		memory: instance.exports.memory,
		channelCount,
	};
}

export function tptArray(values) {
	return Float64Array.of(
		values.g,
		values.k,
		values.m0,
		values.m1,
		values.m2,
	);
}

export function configure(exports, configuration, mode, transitionFrames) {
	assert.equal(
		exports.peq_begin_semantic_configuration(
			configuration.packet.bands.length,
			configuration.packet.outputGainDb,
		),
		0,
	);
	const nativeTypes = {
		peaking: 0,
		lowshelf: 1,
		highshelf: 2,
		highpass: 3,
		lowpass: 4,
		notch: 5,
	};
	for (let bandIndex = 0; bandIndex < configuration.packet.bands.length; bandIndex += 1) {
		const band = configuration.packet.bands[bandIndex];
		assert.equal(
			exports.peq_set_semantic_band(
				bandIndex,
				nativeTypes[band.type],
				band.slopeDbPerOctave,
				band.frequencyHz,
				band.gainDb,
				band.q,
				band.enabled ? 1 : 0,
			),
			0,
		);
	}
	assert.equal(exports.peq_commit_configuration(mode, transitionFrames), 0);
}

export function processNative(runtime, channels, blockFrames) {
	const frames = channels[0].length;
	const output = channels.map(() => new Float32Array(frames));
	for (let offset = 0; offset < frames; offset += blockFrames) {
		const length = Math.min(blockFrames, frames - offset);
		for (let channel = 0; channel < runtime.channelCount; channel += 1) {
			new Float32Array(
				runtime.memory.buffer,
				runtime.exports.peq_input_pointer(channel),
				length,
			).set(channels[channel].subarray(offset, offset + length));
		}
		assert.equal(runtime.exports.peq_process(length), length);
		for (let channel = 0; channel < runtime.channelCount; channel += 1) {
			output[channel].set(new Float32Array(
				runtime.memory.buffer,
				runtime.exports.peq_output_pointer(channel),
				length,
			), offset);
		}
	}
	return output;
}
