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

test('whole generator outputs retain pinned current-main phase and channel RNG fixtures', () => {
	const expected = [
		null, 'b56b02e7ee7e97a900cbfbbdaaaa4ec2e24ea029319b03598a79f98e6fb2e3d0',
		'741a3a7f69e654d5200953b9182db21e72987296bc05d6c30e7a4d9928f305cb',
		'3b6e4a0cc026d617a1bc0ce873fa557df0ec84715cd24b678a78e8121ea9c44a',
		'3385abd5d56d3170c37e3de2c8558c623d45a6717e8067b653a3b0f218bce367',
		'12609a5444e6ac59b7d9f0fd8acf9736dd0a9ac635eefc249e59fb13e74da357',
		'6263498140b668a04c0b2a3e3df7a45f270e7a24866e7b97637d4667560c8413',
		'5b85b5d82bca68d098b4f5048c7d5ad79c2181c5fec269d17249b940105c31d7',
	];
	for (let index = 0; index < cases.length; index += 1) {
		const [type, options] = cases[index];
		if (expected[index]) assert.equal(digest(generateAudioEditorSignal(type, options).channels), expected[index]);
	}
});

// Independently bundled generators.js at main 9c6d928634b2f20f40d3ad145a0991099db1e26a.
const mainFixtures = [
	['noise', {'sampleRate': 8000, 'durationSeconds': 0.000125, 'channelCount': 32, 'color': 'pink', 'seed': 0, 'amplitude': 0.37}, '2bad24f6e3eef633c08b304d65a2e98ddaba00e2521fbf5db05a35fdc54b9774'],
	['noise', {'sampleRate': 8000, 'durationSeconds': 0.255875, 'channelCount': 3, 'color': 'pink', 'seed': 1, 'amplitude': 0.37}, 'b074783cdc529b99626dd71bc7c6db235480e0698c9d62bb60a4d960ad3ea287'],
	['noise', {'sampleRate': 8000, 'durationSeconds': 0.256, 'channelCount': 3, 'color': 'pink', 'seed': 2147483648, 'amplitude': 0.37}, '7f96784485d12f925ef142da986dc2d05ed055bcdeb3d0833002bd50838dff99'],
	['noise', {'sampleRate': 8000, 'durationSeconds': 0.256125, 'channelCount': 3, 'color': 'pink', 'seed': 4294967295, 'amplitude': 0.37}, 'bb4aaa54218cc552f6a0bf419b5acac22c6c3f7ca89598f8e7a24f08cd66bf25'],
	['noise', {'sampleRate': 44100, 'durationSeconds': 2.2675736961451248e-05, 'channelCount': 32, 'color': 'pink', 'seed': 0, 'amplitude': 0.37}, '11fe9946e614b9b913f38591c82c6788acc4f604ad8f36c814ab668ece03eb33'],
	['noise', {'sampleRate': 44100, 'durationSeconds': 0.3714965986394558, 'channelCount': 3, 'color': 'pink', 'seed': 1, 'amplitude': 0.37}, 'ab87f9c1106d2030fa6168311f7f75578d151f276443ed3e724ee7c7e1a5999b'],
	['noise', {'sampleRate': 44100, 'durationSeconds': 0.37151927437641724, 'channelCount': 3, 'color': 'pink', 'seed': 2147483648, 'amplitude': 0.37}, 'e8b5a520629f7fd713c7e52f617fb7839a190a66df2168ee10a9bfa4f6fb7d23'],
	['noise', {'sampleRate': 44100, 'durationSeconds': 0.3715419501133787, 'channelCount': 3, 'color': 'pink', 'seed': 4294967295, 'amplitude': 0.37}, '53af8f330c72b194e87fc27ddfa29ab79514f3e8c8fa419113df01020c578d86'],
	['noise', {'sampleRate': 48000, 'durationSeconds': 2.0833333333333333e-05, 'channelCount': 32, 'color': 'pink', 'seed': 0, 'amplitude': 0.37}, '11fe9946e614b9b913f38591c82c6788acc4f604ad8f36c814ab668ece03eb33'],
	['noise', {'sampleRate': 48000, 'durationSeconds': 0.3413125, 'channelCount': 3, 'color': 'pink', 'seed': 1, 'amplitude': 0.37}, 'ab87f9c1106d2030fa6168311f7f75578d151f276443ed3e724ee7c7e1a5999b'],
	['noise', {'sampleRate': 48000, 'durationSeconds': 0.3413333333333333, 'channelCount': 3, 'color': 'pink', 'seed': 2147483648, 'amplitude': 0.37}, 'e8b5a520629f7fd713c7e52f617fb7839a190a66df2168ee10a9bfa4f6fb7d23'],
	['noise', {'sampleRate': 48000, 'durationSeconds': 0.3413541666666667, 'channelCount': 3, 'color': 'pink', 'seed': 4294967295, 'amplitude': 0.37}, '53af8f330c72b194e87fc27ddfa29ab79514f3e8c8fa419113df01020c578d86'],
	['noise', {'sampleRate': 96000, 'durationSeconds': 1.0416666666666666e-05, 'channelCount': 32, 'color': 'pink', 'seed': 0, 'amplitude': 0.37}, '6b1a49a9efa5d36c4a28bd3f0c7a83de0d447981d0d81d078365f88930622e70'],
	['noise', {'sampleRate': 96000, 'durationSeconds': 0.34132291666666664, 'channelCount': 3, 'color': 'pink', 'seed': 1, 'amplitude': 0.37}, '87ccb2727060578ee9ef1522868942bc2a737c94351242ea72e85a8ecd649177'],
	['noise', {'sampleRate': 96000, 'durationSeconds': 0.3413333333333333, 'channelCount': 3, 'color': 'pink', 'seed': 2147483648, 'amplitude': 0.37}, 'ecaad3017be430b622598428b170d6dadbbfdcde1ecc63b8331ae2ebf0552aac'],
	['noise', {'sampleRate': 96000, 'durationSeconds': 0.34134375, 'channelCount': 3, 'color': 'pink', 'seed': 4294967295, 'amplitude': 0.37}, '335b8a2166643ef4f3894b4f831a5d730045831e616374c277c709122299e16a'],
	['dtmf', {'sampleRate': 8000, 'durationSeconds': 0.000125, 'sequence': '11AB1#D', 'toneSeconds': 0.031125, 'silenceSeconds': 0.009375, 'channelCount': 3, 'amplitude': 0.37}, '15ec7bf0b50732b49f8228e07d24365338f9e3ab994b00af08e5a3bffe55fd8b'],
	['dtmf', {'sampleRate': 8000, 'durationSeconds': 0.002125, 'sequence': '11AB1#D', 'toneSeconds': 0.031125, 'silenceSeconds': 0.009375, 'channelCount': 3, 'amplitude': 0.37}, '7231e20c646b0dc5d93c75ca633a0c9676f59f153fb3416f5e7e02221f9f32b5'],
	['dtmf', {'sampleRate': 8000, 'durationSeconds': 0.031375, 'sequence': '11AB1#D', 'toneSeconds': 0.031125, 'silenceSeconds': 0.009375, 'channelCount': 3, 'amplitude': 0.37}, 'a420a5e21e7668689b45956559529964c99ab47fb01603b74a1bb9fc14c8e787'],
	['dtmf', {'sampleRate': 8000, 'durationSeconds': 0.514625, 'sequence': '11AB1#D', 'toneSeconds': 0.031125, 'silenceSeconds': 0.009375, 'channelCount': 3, 'amplitude': 0.37}, '2ac4a84cb18fa3c0f6795374e3afe2eb2ae1fe2bfdc255a703dc208fdca7b497'],
	['dtmf', {'sampleRate': 8000, 'durationSeconds': 4.137625, 'sequence': '11AB1#D', 'toneSeconds': 0.031125, 'silenceSeconds': 0.009375, 'channelCount': 3, 'amplitude': 0.37}, '9c3e1807b6f2a2471d9307a8eeb74b59111622aa607faa7b8f38dc7d813a4305'],
	['dtmf', {'sampleRate': 48000, 'durationSeconds': 2.037, 'sequence': '11111111111111111', 'toneSeconds': 0.001, 'silenceSeconds': 0.003, 'channelCount': 2, 'amplitude': 0.8}, '54ba9c418d79014abf1223afd8b037c4d3fea9596971e50be5fa5ad0459020e0'],
] as const;

test('streaming preserves current-main pink row draws and duration-scaled DTMF samples', () => {
	for (const [type, options, expected] of mainFixtures) {
		const renderer = createAudioEditorSignalRenderer(type, options);
		assert.equal(renderer.frameCount, Math.round(options.sampleRate * options.durationSeconds));
		const output = Array.from({ length: renderer.channelCount }, () => new Float32Array(renderer.frameCount));
		let offset = 0;
		let iteration = 0;
		for (;;) {
			const block = renderer.next([1, 127, 257, 4_096][iteration++ % 4]);
			if (!block) break;
			const transferred = structuredClone(block, { transfer: block.map((channel) => channel.buffer) });
			for (let channel = 0; channel < output.length; channel += 1) output[channel].set(transferred[channel], offset);
			offset += transferred[0].length;
		}
		assert.equal(digest(output), expected, `${type}: ${JSON.stringify(options)}`);
	}
});

test('DTMF blocks retain their admitted duration when the caller changes its request', () => {
	const options = { sampleRate: 8_000, durationSeconds: 4_117 / 8_000, sequence: '11AB1#D',
		toneSeconds: 0.031125, silenceSeconds: 0.009375, channelCount: 3, amplitude: 0.37 };
	const renderer = createAudioEditorSignalRenderer('dtmf', options);
	Reflect.deleteProperty(options, 'durationSeconds');
	const output = Array.from({ length: renderer.channelCount }, () => new Float32Array(renderer.frameCount));
	let offset = 0;
	for (let block = renderer.next(127); block; block = renderer.next(127)) {
		for (let channel = 0; channel < output.length; channel += 1) output[channel].set(block[channel], offset);
		offset += block[0].length;
	}
	assert.equal(renderer.frameCount, 4_117);
	assert.equal(digest(output), '2ac4a84cb18fa3c0f6795374e3afe2eb2ae1fe2bfdc255a703dc208fdca7b497');
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
