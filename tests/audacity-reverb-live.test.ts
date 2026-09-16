/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { applyAudacityBrowserReverb } from '../src/common/editor/audacity-effects/reverb.js';
import { ReverbLiveProcessor } from '../src/common/editor/audacity-effects/reverb-live-processor.ts';
import {
	audacityBrowserReverbTailFrames,
	normalizeReverbParams,
	type ReverbParams,
} from '../src/common/editor/audacity-effects/reverb-parameters.ts';

const SAMPLE_RATE = 8_000;
const PRESETS: readonly Partial<ReverbParams>[] = [
	{ preDelay: 0, wetGainDb: -6, dryGainDb: 0 },
	{
		roomSize: 100, preDelay: 83, reverberance: 100, damping: 98, toneLow: 21,
		toneHigh: 67, wetGainDb: 3, dryGainDb: -8, stereoWidth: 37, wetOnly: false,
	},
	{
		roomSize: 34, preDelay: 5, reverberance: 81, damping: 0, toneLow: 100,
		toneHigh: 100, wetGainDb: 0, dryGainDb: 0, stereoWidth: 0, wetOnly: true,
	},
];
// Byte-level selection output recorded before extracting the persistent core.
const SELECTION_HASHES = [
	['2f9bc7ab579b35ef3cd1af798ad537fe291913c1f3e27d345c7ee3c2283f53fa', '0cb2d61780839f1981daa1042cb3e5eba545569c136bebc1a06d2c53efffa1da'],
	['ac40aa6b52070916b42cf282f907cad5c2daf260a156757df27c2d93cf04d057', 'cda4aedfda45487d581c519eebc9a79add74d2af0d1c345a64dcc83346943c4d'],
	['19ac75909d0b2476412a7b0223f038196209b2394df43fb594922fbcbc3b54d7', '19ac75909d0b2476412a7b0223f038196209b2394df43fb594922fbcbc3b54d7'],
];

for (const [index, params] of PRESETS.entries()) {
	test(`persistent reverb preserves selection output and block partition parity for preset ${index}`, () => {
		const input = signal();
		const expected = applyAudacityBrowserReverb(input, SAMPLE_RATE, params);
		assert.deepEqual(expected.map(hashAudio), SELECTION_HASHES[index]);
		for (const sizes of [[1], [17, 129, 5, 61], [128], [6_144]]) {
			const actual = processBlocks(new ReverbLiveProcessor(SAMPLE_RATE, params), input, sizes);
			assert.deepEqual(actual, expected, `partition ${sizes.join(',')}`);
		}
	});
}

test('live reverb keeps pre-delay across tiny blocks and aligns its dry path', () => {
	const input = [new Float32Array(4_096)];
	input[0][0] = 1;
	const wet = processBlocks(new ReverbLiveProcessor(SAMPLE_RATE, {
		preDelay: 50, wetOnly: true, wetGainDb: 0,
	}), input, [1, 3, 17]);
	assert.ok(wet[0].subarray(0, 400).every((value) => value === 0));
	assert.ok(wet[0].subarray(400).some((value) => value !== 0));
	const dry = processBlocks(new ReverbLiveProcessor(SAMPLE_RATE, {
		preDelay: 50, dryGainDb: 0, wetGainDb: -60,
	}), input, [3]);
	assert.equal(dry[0][0], 1);
});

test('live reverb stereo mixing is safe with in-place, swapped, and overlapping inputs', () => {
	for (const stereoWidth of [0, 37, 100]) {
		const params = { ...PRESETS[1], stereoWidth };
		const input = signal(1_024);
		const expected = applyAudacityBrowserReverb(input, SAMPLE_RATE, params);
		const inplace = input.map((channel) => channel.slice());
		new ReverbLiveProcessor(SAMPLE_RATE, params).process(inplace, inplace);
		assert.deepEqual(inplace, expected);
		const swapped = input.map((channel) => channel.slice());
		const swappedOutput = [swapped[1], swapped[0]];
		new ReverbLiveProcessor(SAMPLE_RATE, params).process(swapped, swappedOutput);
		assert.deepEqual(swappedOutput, expected);
		const backing = new Float32Array(1_029);
		backing.set(input[0]);
		const source = backing.subarray(0, 1_024);
		const output = backing.subarray(5);
		new ReverbLiveProcessor(SAMPLE_RATE, params).process([source], [output]);
		assert.deepEqual(output, applyAudacityBrowserReverb([input[0]], SAMPLE_RATE, params)[0]);
	}
	const mono = signal(1_024).slice(0, 1);
	const stereo = [new Float32Array(1_024), new Float32Array(1_024)];
	new ReverbLiveProcessor(SAMPLE_RATE, PRESETS[0]).process(mono, stereo);
	assert.deepEqual(stereo, applyAudacityBrowserReverb([mono[0], mono[0]], SAMPLE_RATE, PRESETS[0]));
});

test('reverb reset and parameter updates clear history and preserve all ten controls', () => {
	const processor = new ReverbLiveProcessor(SAMPLE_RATE);
	assert.deepEqual(processor.params, normalizeReverbParams());
	assert.equal(processor.params.wetGainDb, -1);
	assert.equal(processor.params.dryGainDb, -1);
	assert.equal(processor.type, 'audacity-reverb');
	assert.equal(processor.latencyFrames, 0);
	assert.equal(processor.readAnalysis(), null);
	assert.throws(() => processor.setNoiseProfile(), /does not use a noise profile/);
	const input = signal(1_024);
	processor.process(input, input.map((channel) => new Float32Array(channel.length)));
	processor.reset();
	assert.deepEqual(processBlocks(processor, input, [128]), applyAudacityBrowserReverb(input, SAMPLE_RATE));
	processor.updateParams(PRESETS[1]);
	assert.deepEqual(processor.params, normalizeReverbParams(PRESETS[1]));
	assert.equal(processor.tailFrames, audacityBrowserReverbTailFrames(SAMPLE_RATE, PRESETS[1]));
	assert.deepEqual(processBlocks(processor, input, [17]), applyAudacityBrowserReverb(input, SAMPLE_RATE, PRESETS[1]));
	const previous = processor.params;
	assert.throws(() => processor.updateParams({ damping: 101 }), /damping must be between/);
	assert.equal(processor.params, previous);
	processor.updateParams({ wetOnly: true, stereoWidth: 0 });
	assert.equal(processor.params.roomSize, 100);
	assert.equal(processor.params.wetOnly, true);
});

test('reverb processes absent input as silence, emits its tail, and clears it on reset', () => {
	const processor = new ReverbLiveProcessor(SAMPLE_RATE, { preDelay: 0, wetOnly: true });
	const output = [new Float32Array(128)];
	output[0].fill(1);
	assert.equal(processor.process([], output), true);
	assert.ok(output[0].every((value) => value === 0));
	const input = [new Float32Array(128)];
	input[0][0] = 1;
	processor.process(input, output);
	let tailEnergy = 0;
	for (let block = 0; block < 24; block += 1) {
		processor.process([], output);
		for (const value of output[0]) tailEnergy += value * value;
	}
	assert.ok(tailEnergy > 0);
	processor.reset();
	processor.process([], output);
	assert.ok(output[0].every((value) => value === 0));
});

test('simple realtime control edits preserve the wet tail while explicit reset clears it', () => {
	const params = { ...PRESETS[0], wetOnly: true, wetGainDb: 0 };
	const updated = new ReverbLiveProcessor(SAMPLE_RATE, params);
	const unchanged = new ReverbLiveProcessor(SAMPLE_RATE, params);
	const input = signal(2_048);
	const initial = input.map((channel) => new Float32Array(channel.length));
	updated.process(input, initial);
	unchanged.process(input, initial);
	updated.updateParams({ wetGainDb: 6 });
	const actual = [new Float32Array(128), new Float32Array(128)];
	const expected = [new Float32Array(128), new Float32Array(128)];
	updated.process([], actual);
	unchanged.process([], expected);
	assert.ok(expected[0].some((sample) => sample !== 0));
	for (let channel = 0; channel < actual.length; channel += 1) {
		for (let frame = 0; frame < actual[channel].length; frame += 1) {
			assert.ok(Math.abs(actual[channel][frame] - expected[channel][frame] * 10 ** (6 / 20)) < 1e-7);
		}
	}
	for (const update of [
		{ dryGainDb: -4 }, { wetOnly: false }, { reverberance: 70 }, { damping: 80 },
		{ toneLow: 30 }, { toneHigh: 20 },
	]) {
		updated.updateParams(update);
		updated.process([], actual);
		assert.ok(actual[0].some((sample) => sample !== 0), JSON.stringify(update));
	}
	updated.reset();
	updated.process([], actual);
	assert.ok(actual.every((channel) => channel.every((sample) => sample === 0)));
});

test('structural realtime reverb edits reinitialize delay history', () => {
	for (const update of [{ roomSize: 31 }, { preDelay: 80 }, { stereoWidth: 39 }]) {
		const processor = new ReverbLiveProcessor(SAMPLE_RATE, PRESETS[0]);
		const input = signal(2_048);
		processor.process(input, input.map((channel) => new Float32Array(channel.length)));
		processor.updateParams(update);
		assert.deepEqual(processBlocks(processor, input, [128]), applyAudacityBrowserReverb(input, SAMPLE_RATE, {
			...PRESETS[0], ...update,
		}));
	}
});

test('reverb runtime parameter messages normalize wet-only strings consistently', () => {
	const processor = new ReverbLiveProcessor(SAMPLE_RATE);
	// Worklet messages cross a JavaScript boundary before reaching this strict
	// domain API, so exercise their untrusted string representation explicitly.
	const update = processor.updateParams.bind(processor) as unknown as (params: Record<string, unknown>) => void;
	for (const value of ['0', 'false', 'off', '', 'TRUE', 'true', '1', 'on', 'yes']) {
		update({ wetOnly: value });
		assert.equal(processor.params.wetOnly, ['true', '1', 'on'].includes(value), value);
	}
});

test('warmed live reverb reuses typed storage across processing and reset', () => {
	const processor = new ReverbLiveProcessor(SAMPLE_RATE, PRESETS[1]);
	const input = signal(128);
	const output = input.map((channel) => new Float32Array(channel.length));
	processor.process(input, output);
	const Original = globalThis.Float32Array;
	let allocations = 0;
	globalThis.Float32Array = new Proxy(Original, {
		construct(target, args) {
			allocations += 1;
			return Reflect.construct(target, args);
		},
	});
	try {
		for (let block = 0; block < 20; block += 1) processor.process(input, output);
		processor.updateParams({ wetGainDb: 6, toneHigh: 33 });
		processor.process(input, output);
		processor.reset();
		processor.process(input, output);
		assert.equal(allocations, 0);
	} finally {
		globalThis.Float32Array = Original;
	}
});

test('reverb declares a finite conservative tail that covers its wet decay', () => {
	assert.equal(audacityBrowserReverbTailFrames(SAMPLE_RATE, { reverberance: 0 }), 0);
	assert.throws(() => audacityBrowserReverbTailFrames(0), /sampleRate/);
	assert.throws(() => new ReverbLiveProcessor(Number.NaN), /sampleRate/);
	const params = {
		roomSize: 100, preDelay: 200, reverberance: 100, damping: 100, toneLow: 100,
		toneHigh: 0, wetGainDb: 12, dryGainDb: 12, stereoWidth: 100, wetOnly: true,
	};
	const tail = audacityBrowserReverbTailFrames(SAMPLE_RATE, params);
	assert.ok(Number.isSafeInteger(tail) && tail > 0);
	assert.ok(tail < SAMPLE_RATE * 60, 'the conservative maximum remains a bounded audio tail');
	assert.ok(tail >= audacityBrowserReverbTailFrames(SAMPLE_RATE, PRESETS[0]));
	const processor = new ReverbLiveProcessor(SAMPLE_RATE, params);
	const input = Array.from({ length: 32 }, () => new Float32Array(128));
	const output = input.map((channel) => new Float32Array(channel.length));
	input[31][0] = 1;
	processor.process(input, output);
	for (let processed = 0; processed < tail; processed += 128) processor.process([], output);
	assert.ok(output.every((channel) => channel.every((value) => Number.isFinite(value) && Math.abs(value) < 1e-6)));
});

test('declared reverb tail covers bounded input histories as well as isolated impulses', () => {
	const params = {
		roomSize: 100, preDelay: 200, reverberance: 100, damping: 0, toneLow: 100,
		toneHigh: 100, wetGainDb: 12, dryGainDb: 12, stereoWidth: 100, wetOnly: true,
	};
	const tail = audacityBrowserReverbTailFrames(SAMPLE_RATE, params);
	const duration = SAMPLE_RATE * 4;
	const impulse = Array.from({ length: 32 }, () => new Float32Array(128));
	const output = impulse.map((channel) => new Float32Array(channel.length));
	impulse[31][0] = 1;
	const suffix = new Float32Array(duration);
	const probe = new ReverbLiveProcessor(SAMPLE_RATE, params);
	for (let offset = 0; offset < tail + duration; offset += 128) {
		probe.process(offset === 0 ? impulse : [], output);
		for (let frame = 0; frame < 128; frame += 1) {
			const position = offset + frame - tail;
			if (position >= 0 && position < duration) suffix[position] = output[31][frame];
		}
	}
	// Reverse the suffix signs to make its absolute impulse-response mass add
	// coherently at exactly the declared tail after the last source sample.
	const history = Array.from({ length: 32 }, () => new Float32Array(duration));
	for (let frame = 0; frame < duration; frame += 1) history[31][frame] = Math.sign(suffix[duration - 1 - frame]);
	const processor = new ReverbLiveProcessor(SAMPLE_RATE, params);
	processor.process(history, history.map((channel) => new Float32Array(channel.length)));
	let response = 0;
	for (let offset = 0; offset < tail; offset += 128) {
		const frames = Math.min(128, tail - offset);
		const block = frames === 128 ? output : output.map((channel) => channel.subarray(0, frames));
		processor.process([], block);
		response = block[31][frames - 1];
	}
	const mass = suffix.reduce((total, sample) => total + Math.abs(sample), 0);
	assert.ok(response > 0 && Math.abs(response - mass) < 1e-10);
	assert.ok(response < 1e-6, `bounded input response ${response} remains below the settling threshold`);
});

function signal(length = 6_144): Float32Array[] {
	return Array.from({ length: 2 }, (_, channel) => Float32Array.from({ length }, (_, frame) => (
		Math.sin(frame * (0.037 + channel * 0.013)) * 0.15 + (frame % 997 === channel ? 0.4 : 0)
	)));
}

function hashAudio(channel: Float32Array): string {
	return createHash('sha256').update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength)).digest('hex');
}

function processBlocks(processor: ReverbLiveProcessor, input: Float32Array[], sizes: readonly number[]): Float32Array[] {
	const output = input.map((channel) => new Float32Array(channel.length));
	let offset = 0;
	let block = 0;
	while (offset < input[0].length) {
		const length = Math.min(sizes[block % sizes.length], input[0].length - offset);
		processor.process(input.map((channel) => channel.subarray(offset, offset + length)), output.map((channel) => channel.subarray(offset, offset + length)));
		offset += length;
		block += 1;
	}
	return output;
}
