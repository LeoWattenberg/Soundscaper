import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createAudioEditorSignalRenderer, generateAudioEditorSignal } from '../src/common/editor/generators.js';

const cases = [
	['silence', { sampleRate: 8_000, durationSeconds: 0.513, channelCount: 3 }],
	['tone', { sampleRate: 8_000, durationSeconds: 0.0475, channelCount: 3, frequency: 997 }],
	['chirp', { sampleRate: 8_000, durationSeconds: 0.033, channelCount: 3, startFrequency: 123, endFrequency: 3_401, startAmplitude: 0.2, endAmplitude: 0.9 }],
	['dtmf', { sampleRate: 8_000, sequence: '1122#11', toneSeconds: 0.03125, silenceSeconds: 0.005, channelCount: 3 }],
	['morse', { sampleRate: 8_000, text: 'SOS', wordsPerMinute: 120, channelCount: 3 }],
	...['white', 'pink', 'brown'].map((color) => ['noise', {
		sampleRate: 8_000, durationSeconds: 0.513, channelCount: 3, color, seed: 42,
	}] as const),
] as const;

function digest(channels: readonly Float32Array[]): string {
	const hash = createHash('sha256');
	for (const channel of channels) hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
	return hash.digest('hex');
}

test('stateful generator blocks match whole outputs at every phase, keying and noise boundary', () => {
	for (const [type, options] of cases) for (const blockFrames of [1, 127, 128, 129, 257, 4_096]) {
		const expected = generateAudioEditorSignal(type, options);
		const renderer = createAudioEditorSignalRenderer(type, options);
		const channels = Array.from({ length: renderer.channelCount }, () => new Float32Array(renderer.frameCount));
		let offset = 0;
		for (let block = renderer.next(blockFrames); block; block = renderer.next(blockFrames)) {
			assert.equal(block.length, renderer.channelCount);
			assert.ok(block[0].length <= blockFrames);
			assert.equal(new Set(block.map((channel) => channel.buffer)).size, renderer.channelCount);
			for (let channel = 0; channel < channels.length; channel += 1) channels[channel].set(block[channel], offset);
			offset += block[0].length;
		}
		assert.equal(offset, renderer.frameCount);
		assert.equal(renderer.next(blockFrames), null);
		assert.deepEqual(channels, expected.channels, `${type}, block ${blockFrames}`);
	}
});

test('whole generator outputs retain pinned pre-refactor phase and channel RNG fixtures', () => {
	const expected = [
		null, 'b56b02e7ee7e97a900cbfbbdaaaa4ec2e24ea029319b03598a79f98e6fb2e3d0',
		'741a3a7f69e654d5200953b9182db21e72987296bc05d6c30e7a4d9928f305cb',
		'3b6e4a0cc026d617a1bc0ce873fa557df0ec84715cd24b678a78e8121ea9c44a',
		'3385abd5d56d3170c37e3de2c8558c623d45a6717e8067b653a3b0f218bce367',
		'12609a5444e6ac59b7d9f0fd8acf9736dd0a9ac635eefc249e59fb13e74da357',
		'7c05e5f023e4053f9fafb4887166f76d43d4de3ce955d674cade1e5b66eba2b4',
		'5b85b5d82bca68d098b4f5048c7d5ad79c2181c5fec269d17249b940105c31d7',
	];
	for (let index = 0; index < cases.length; index += 1) {
		const [type, options] = cases[index];
		if (expected[index]) assert.equal(digest(generateAudioEditorSignal(type, options).channels), expected[index]);
	}
});

test('adaptive blocks remain independent after the caller transfers every prior buffer', () => {
	for (const [type, options] of cases) {
		const expected = generateAudioEditorSignal(type, options);
		const renderer = createAudioEditorSignalRenderer(type, options);
		const channels = expected.channels.map((channel) => new Float32Array(channel.length));
		let offset = 0;
		let iteration = 0;
		for (;;) {
			const block = renderer.next([17, 131, 509, 2][iteration++ % 4]);
			if (!block) break;
			const transferred = structuredClone(block, { transfer: block.map((channel) => channel.buffer) });
			for (let channel = 0; channel < channels.length; channel += 1) channels[channel].set(transferred[channel], offset);
			offset += transferred[0].length;
		}
		assert.deepEqual(channels, expected.channels, type);
	}
});

test('noise channel jumps reproduce the sequential RNG at all supported channel counts', () => {
	for (const seed of [0, 1, 0x8000_0000, 0xffff_ffff]) {
		let state = seed || 1;
		const expected = Array.from({ length: 32 }, () => Float32Array.from({ length: 127 }, () => {
			state ^= state << 13;
			state ^= state >>> 17;
			state ^= state << 5;
			return ((state >>> 0) / 0x8000_0000 - 1) * 0.8;
		}));
		const renderer = createAudioEditorSignalRenderer('noise', {
			seed, sampleRate: 8_000, channelCount: 32, durationSeconds: 127 / 8_000,
		});
		const output = expected.map(() => new Float32Array(127));
		for (let frame = 0; frame < 127; frame += 1) {
			const block = renderer.next(1)!;
			for (let channel = 0; channel < 32; channel += 1) output[channel][frame] = block[channel][0];
		}
		assert.deepEqual(output, expected);
	}
});

test('large generator jobs allocate only bounded output blocks before publication', () => {
	const original = globalThis.Float32Array;
	let largest = 0;
	globalThis.Float32Array = new Proxy(original, {
		construct(target, argumentsList, newTarget) {
			const result: Float32Array = Reflect.construct(target, argumentsList, newTarget);
			largest = Math.max(largest, result.length);
			return result;
		},
	});
	try {
		for (const [type, options] of [
			['noise', { durationSeconds: 7_200, sampleRate: 48_000, channelCount: 7, color: 'pink' }],
			['dtmf', { sampleRate: 48_000, channelCount: 3, toneSeconds: 600, silenceSeconds: 10, sequence: '121212' }],
			['tone', { sampleRate: 48_000, channelCount: 32, durationSeconds: 7_200 }],
		] as const) {
			const renderer = createAudioEditorSignalRenderer(type, options);
			assert.ok(renderer.frameCount > 10_000_000);
			assert.equal(renderer.next(512)?.[0].length, 512);
			assert.equal(renderer.next(513)?.[0].length, 513);
		}
		assert.equal(largest, 513);
	} finally {
		globalThis.Float32Array = original;
	}
});

test('stateful generation validates requests before emitting a block', () => {
	assert.throws(() => createAudioEditorSignalRenderer('noise', { durationSeconds: 0 }), /durationSeconds/);
	assert.throws(() => createAudioEditorSignalRenderer('dtmf', { sequence: 'x' }), /unsupported symbol/);
	const renderer = createAudioEditorSignalRenderer('tone');
	assert.throws(() => renderer.next(0), /blockFrames/);
	assert.throws(() => renderer.next(1.5), /blockFrames/);
	assert.equal(renderer.next(1)?.[0].length, 1);
});
