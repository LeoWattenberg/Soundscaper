/*
 * The bitcrusher runs in an AudioWorklet during playback and in the selection
 * worker when it is applied destructively. Both hosts drive one shared core,
 * and these tests pin the property that makes that worth doing: the output
 * must not depend on how the stream was divided into blocks.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyBitcrusher,
	createBitcrusherProcessor,
} from '../src/common/editor/first-party-effects/bitcrusher/dsp.js';
import { applyAudioSelectionEffectAsync } from '../src/common/editor/selection-effects-runtime.js';

const SAMPLE_RATE = 48_000;
const IRREGULAR_BLOCKS = Object.freeze([17, 128, 61, 257, 3, 911]);
const RENDER_QUANTUM = 128;

const CASES = Object.freeze([
	{ bitDepth: 8, dither: 'none', downsampling: 1, interpolation: 'sample-hold', mix: 100 },
	{ bitDepth: 5, dither: 'triangular', downsampling: 7.5, interpolation: 'linear', mix: 80 },
	{ bitDepth: 3, dither: 'triangular-highpass', downsampling: 16, interpolation: 'cubic', mix: 100 },
	{ bitDepth: 12, dither: 'shaped', downsampling: 2, interpolation: 'smooth', mix: 65 },
	{ bitDepth: 1, dither: 'rectangular', downsampling: 33, interpolation: 'cubic', mix: 100 },
	{ bitDepth: 16, dither: 'shaped', downsampling: 64, interpolation: 'linear', mix: 33 },
]);

function stereo(frames) {
	return [
		Float32Array.from({ length: frames }, (unused, index) => Math.sin(index * 0.031) * 0.8),
		Float32Array.from({ length: frames }, (unused, index) => Math.sin(index * 0.017) * 0.6),
	];
}

function stream(channels, params, blockSizes) {
	const frames = channels[0].length;
	const processor = createBitcrusherProcessor({
		sampleRate: SAMPLE_RATE, channelCount: channels.length, params,
	});
	const output = channels.map(() => new Float32Array(frames));
	let offset = 0;
	let block = 0;
	while (offset < frames) {
		const size = Math.min(blockSizes[block % blockSizes.length], frames - offset);
		processor.processBlock(
			channels.map((channel) => channel.subarray(offset, offset + size)),
			output.map((channel) => channel.subarray(offset, offset + size)),
			size,
		);
		offset += size;
		block += 1;
	}
	return output;
}

test('streaming in render quanta matches rendering the selection in one pass', () => {
	const channels = stereo(6_000);
	for (const params of CASES) {
		const rendered = applyBitcrusher(channels, SAMPLE_RATE, params);
		const played = stream(channels, params, [RENDER_QUANTUM]);
		assert.deepEqual(played, rendered, JSON.stringify(params));
	}
});

test('no block division changes a sample, including sizes that straddle hold intervals', () => {
	const channels = stereo(6_000);
	for (const params of CASES) {
		const rendered = applyBitcrusher(channels, SAMPLE_RATE, params);
		assert.deepEqual(stream(channels, params, IRREGULAR_BLOCKS), rendered, JSON.stringify(params));
	}
});

test('a reset returns the processor to its opening state', () => {
	const channels = stereo(2_048);
	const params = CASES[3];
	const processor = createBitcrusherProcessor({
		sampleRate: SAMPLE_RATE, channelCount: 2, params,
	});
	const first = channels.map(() => new Float32Array(channels[0].length));
	processor.processBlock(channels, first, channels[0].length);
	processor.reset();
	const second = channels.map(() => new Float32Array(channels[0].length));
	processor.processBlock(channels, second, channels[0].length);
	assert.deepEqual(second, first);
});

test('the destructive selection path renders exactly what playback produces', async () => {
	const channels = stereo(4_096);
	for (const params of CASES) {
		const applied = await applyAudioSelectionEffectAsync('bitcrusher', channels, SAMPLE_RATE, params);
		assert.deepEqual(applied, stream(channels, params, [RENDER_QUANTUM]), JSON.stringify(params));
	}
});

test('mono and stereo selections keep their own geometry', async () => {
	const [left] = stereo(1_024);
	const params = CASES[1];
	const mono = await applyAudioSelectionEffectAsync('bitcrusher', [left], SAMPLE_RATE, params);
	assert.equal(mono.length, 1);
	assert.equal(mono[0].length, left.length);
	// A channel is crushed the same way whether or not it has a neighbour,
	// because each carries its own decimation-independent noise stream.
	const pair = await applyAudioSelectionEffectAsync('bitcrusher', [left, left], SAMPLE_RATE, params);
	assert.deepEqual(pair[0], mono[0]);
});
