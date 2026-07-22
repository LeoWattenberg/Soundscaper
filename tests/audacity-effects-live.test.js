import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDACITY_LIVE_EFFECT_CAPABILITIES,
	audacityLiveEffectCapability,
	audacityLiveEffectLatencyFrames,
	audacityLiveEffectTailFrames,
	createAudacityLiveProcessor,
	isAudacityLiveEffect,
} from '../src/common/editor/audacity-effects/live.js';
import {
	AUDACITY_LIVE_WORKLET_NAME,
	AudacityLiveEffectProcessor,
} from '../src/common/editor/audacity-effects/live-worklet.js';
import { applyAudacityEffect } from '../src/common/editor/audacity-effects/index.js';
import { audacityEffectTypes } from '../src/common/editor/audacity-effects/manifest.js';
import { captureAudacityNoiseProfile } from '../src/common/editor/audacity-effects/spectral.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

const SAMPLE_RATE = 48_000;
const LIVE_TYPES = [
	'audacity-auto-duck',
	'audacity-bass-treble',
	'audacity-click-removal',
	'audacity-compressor',
	'audacity-distortion',
	'audacity-echo',
	'audacity-filter-curve-eq',
	'audacity-graphic-eq',
	'audacity-invert',
	'audacity-limiter',
	'audacity-noise-reduction',
	'audacity-phaser',
	'audacity-classic-filters',
	'audacity-wahwah',
];

function signal(frames, sampleRate = SAMPLE_RATE) {
	return Float32Array.from({ length: frames }, (_, frame) => (
		0.31 * Math.sin(2 * Math.PI * 317 * frame / sampleRate)
		+ 0.13 * Math.sin(2 * Math.PI * 5_731 * frame / sampleRate)
	));
}

function processStream(processor, channels, {
	blockSizes = [17, 128, 61, 257, 3, 911],
	sidechain = [],
} = {}) {
	const frameCount = channels[0].length;
	const output = channels.map(() => new Float32Array(frameCount));
	let position = 0;
	let blockIndex = 0;
	while (position < frameCount) {
		const frames = Math.min(blockSizes[blockIndex % blockSizes.length], frameCount - position);
		const inputBlock = channels.map((channel) => channel.slice(position, position + frames));
		const outputBlock = output.map(() => new Float32Array(frames));
		const sidechainBlock = sidechain.map((channel) => channel.slice(position, position + frames));
		processor.process(inputBlock, outputBlock, sidechainBlock);
		for (let channel = 0; channel < output.length; channel += 1) output[channel].set(outputBlock[channel], position);
		position += frames;
		blockIndex += 1;
	}
	return output;
}

function maximumDifference(left, right) {
	assert.equal(left.length, right.length);
	let maximum = 0;
	for (let frame = 0; frame < left.length; frame += 1) maximum = Math.max(maximum, Math.abs(left[frame] - right[frame]));
	return maximum;
}

test('live capability contract classifies every native effect and rejects selection-only construction', () => {
	assert.deepEqual(Object.keys(AUDACITY_LIVE_EFFECT_CAPABILITIES), audacityEffectTypes());
	assert.deepEqual(audacityEffectTypes().filter(isAudacityLiveEffect), LIVE_TYPES);
	assert.equal(isAudacityLiveEffect('highpass'), false);
	assert.equal(isAudacityLiveEffect('not-an-effect'), false);
	assert.equal(audacityLiveEffectCapability('audacity-reverse').mode, 'selection-only');
	assert.match(audacityLiveEffectCapability('audacity-reverse').reason, /complete selection/);
	assert.throws(() => audacityLiveEffectCapability('not-an-effect'), /Unsupported/);
	assert.throws(() => createAudacityLiveProcessor('audacity-reverse', SAMPLE_RATE), /selection-only/);

	assert.deepEqual(audacityLiveEffectCapability('audacity-echo').paramRanges, {
		delaySeconds: [0.001, 10], decay: [0, 0.999],
	});
	assert.deepEqual(audacityLiveEffectCapability('audacity-auto-duck').paramRanges, { maximumPause: [0, 7] });
	assert.throws(() => createAudacityLiveProcessor('audacity-echo', SAMPLE_RATE, { delaySeconds: 11 }), /live processing/);
	assert.throws(() => createAudacityLiveProcessor('audacity-echo', SAMPLE_RATE, { decay: 1 }), /live processing/);
	assert.throws(() => createAudacityLiveProcessor('audacity-auto-duck', SAMPLE_RATE, { maximumPause: 8 }), /live processing/);
});

test('capability latency and tail functions are pure and parameter-aware', () => {
	assert.equal(audacityLiveEffectLatencyFrames('audacity-limiter', SAMPLE_RATE, { lookaheadMs: 10 }), 480);
	assert.equal(audacityLiveEffectLatencyFrames('audacity-compressor', SAMPLE_RATE, { lookaheadMs: 5 }), 240);
	assert.equal(audacityLiveEffectLatencyFrames('audacity-click-removal', SAMPLE_RATE), 8_191);
	assert.equal(audacityLiveEffectLatencyFrames('audacity-click-removal', SAMPLE_RATE, { threshold: 0 }), 0);
	assert.equal(audacityLiveEffectLatencyFrames('audacity-filter-curve-eq', SAMPLE_RATE, { filterLength: 255 }), 255);
	assert.equal(audacityLiveEffectTailFrames('audacity-filter-curve-eq', SAMPLE_RATE, { filterLength: 255 }), 127);
	assert.equal(audacityLiveEffectTailFrames('audacity-echo', SAMPLE_RATE, { delaySeconds: 0.01, decay: 0.5 }), 4_800);
});

test('causal live processors are block-stable and sample-identical to one-shot DSP', () => {
	const input = signal(5_000);
	const cases = [
		['audacity-bass-treble', { bassDb: 4, trebleDb: -3, volumeDb: 1 }],
		['audacity-distortion', { mode: 'cubic', parameter1: 75, parameter2: 80, repeats: 3, dcBlock: true }],
		['audacity-echo', { delaySeconds: 0.01, decay: 0.4 }],
		['audacity-invert', {}],
		['audacity-phaser', { stages: 8, depth: 180, feedbackPercent: 30 }],
		['audacity-classic-filters', { family: 'chebyshev-ii', direction: 'highpass', order: 7, cutoffHz: 1_200 }],
		['audacity-wahwah', { frequency: 2, phaseDegrees: 45, resonance: 4 }],
	];
	for (const [type, params] of cases) {
		const expected = applyAudacityEffect(type, [input], SAMPLE_RATE, params)[0];
		const actual = processStream(createAudacityLiveProcessor(type, SAMPLE_RATE, params), [input])[0];
		assert.deepEqual(actual, expected, type);
	}
	const mono = Float32Array.of(0.25, -0.5, 0.75);
	const stereoOutput = [new Float32Array(mono.length), new Float32Array(mono.length)];
	createAudacityLiveProcessor('audacity-invert', SAMPLE_RATE).process([mono], stereoOutput);
	assert.deepEqual(stereoOutput[0], Float32Array.of(-0.25, 0.5, -0.75));
	assert.deepEqual(stereoOutput[1], stereoOutput[0]);
});

test('linked Compressor and Limiter preserve lookahead DSP across arbitrary block boundaries', () => {
	const input = signal(5_000).map((sample) => sample * 2.5);
	for (const [type, params] of [
		['audacity-compressor', { thresholdDb: -20, lookaheadMs: 10, attackMs: 20 }],
		['audacity-limiter', { thresholdDb: -10, lookaheadMs: 10, releaseMs: 30 }],
	]) {
		const processor = createAudacityLiveProcessor(type, SAMPLE_RATE, params);
		const latency = processor.latencyFrames;
		const padded = new Float32Array(input.length + latency);
		padded.set(input);
		const delayed = processStream(processor, [padded])[0];
		const actual = delayed.slice(latency, latency + input.length);
		const expected = applyAudacityEffect(type, [input], SAMPLE_RATE, params)[0];
		assert.deepEqual(actual, expected, type);
	}
});

test('Auto Duck retains sidechain analysis and retroactive fades across block boundaries', () => {
	const sampleRate = 1_000;
	const params = {
		outerFadeDown: 0.1, outerFadeUp: 0.1, innerFadeDown: 0.05,
		innerFadeUp: 0.05, maximumPause: 0.2, thresholdDb: -20,
	};
	const program = new Float32Array(3_000).fill(0.5);
	const control = new Float32Array(3_000);
	control.fill(0.5, 500, 1_000);
	control.fill(0.5, 1_100, 1_500);
	control.fill(0.5, 2_200, 2_500);
	const processor = createAudacityLiveProcessor('audacity-auto-duck', sampleRate, params);
	const latency = processor.latencyFrames;
	const paddedProgram = new Float32Array(program.length + latency + 500);
	const paddedControl = new Float32Array(paddedProgram.length);
	 paddedProgram.set(program);
	 paddedControl.set(control);
	const delayed = processStream(processor, [paddedProgram], { sidechain: [paddedControl] })[0];
	const expected = applyAudacityEffect(
		'audacity-auto-duck', [paddedProgram], sampleRate, params,
		{ controlChannels: [paddedControl] },
	)[0];
	assert.deepEqual(delayed.slice(latency, latency + program.length), expected.slice(0, program.length));
});

test('Click Removal preserves its modified overlap independently of host block sizes', () => {
	const input = signal(24_000);
	input[5_000] = 1;
	input[12_000] = -1;
	const latency = audacityLiveEffectLatencyFrames('audacity-click-removal', SAMPLE_RATE);
	const padded = new Float32Array(input.length + latency);
	padded.set(input);
	const fixed = processStream(createAudacityLiveProcessor('audacity-click-removal', SAMPLE_RATE), [padded], { blockSizes: [128] })[0];
	const irregular = processStream(createAudacityLiveProcessor('audacity-click-removal', SAMPLE_RATE), [padded])[0];
	assert.deepEqual(irregular, fixed);

	const extended = new Float32Array(input.length + CLICK_TEST_PADDING);
	extended.set(input);
	const expected = applyAudacityEffect('audacity-click-removal', [extended], SAMPLE_RATE)[0];
	assert.deepEqual(fixed.slice(latency, latency + 16_384), expected.slice(0, 16_384));
});

const CLICK_TEST_PADDING = 8_192;

test('partitioned live equalizers reproduce centered one-shot FIR output after declared latency', () => {
	const input = signal(2_000);
	const cases = [
		['audacity-filter-curve-eq', {
			filterLength: 255,
			points: [{ frequency: 20, gain: 6 }, { frequency: 20_000, gain: -6 }],
		}],
		['audacity-graphic-eq', {
			filterLength: 255,
			gains: Array.from({ length: 31 }, (_, index) => index < 15 ? 3 : -3),
		}],
	];
	for (const [type, params] of cases) {
		const processor = createAudacityLiveProcessor(type, SAMPLE_RATE, params);
		const padded = new Float32Array(input.length + processor.latencyFrames + processor.tailFrames + 256);
		padded.set(input);
		const delayed = processStream(processor, [padded], { blockSizes: [128] })[0];
		const actual = delayed.slice(processor.latencyFrames, processor.latencyFrames + input.length);
		const expected = applyAudacityEffect(type, [input], SAMPLE_RATE, params)[0];
		assert.ok(maximumDifference(actual, expected) <= 3e-7, type);
	}
});

test('live Noise Reduction accepts persisted profiles and is exact away from finite-stream edges', () => {
	const sampleRate = 8_000;
	const noise = Float32Array.from({ length: 4_096 }, (_, frame) => (
		0.02 * Math.sin(frame * 1.7) + 0.01 * Math.sin(frame * 0.33)
	));
	const profile = captureAudacityNoiseProfile([noise], sampleRate);
	const persistedProfile = { ...profile, meanPowers: [...profile.meanPowers] };
	const input = Float32Array.from({ length: 20_000 }, (_, frame) => (
		noise[frame % noise.length] + 0.2 * Math.sin(frame * 0.05)
	));
	const processor = createAudacityLiveProcessor(
		'audacity-noise-reduction', sampleRate, {}, { noiseProfile: persistedProfile },
	);
	const padded = new Float32Array(input.length + processor.latencyFrames + 8_192);
	padded.set(input);
	const fixed = processStream(
		createAudacityLiveProcessor('audacity-noise-reduction', sampleRate, {}, { noiseProfile: profile }),
		[padded], { blockSizes: [128] },
	)[0];
	const irregular = processStream(processor, [padded])[0];
	assert.deepEqual(irregular, fixed);
	const expectedInput = new Float32Array(input.length + 8_192);
	expectedInput.set(input);
	const expected = applyAudacityEffect(
		'audacity-noise-reduction', [expectedInput], sampleRate, {}, { noiseProfile: profile },
	)[0];
	const stableFrames = input.length - 4_096;
	assert.deepEqual(
		fixed.slice(processor.latencyFrames, processor.latencyFrames + stableFrames),
		expected.slice(0, stableFrames),
	);
});

test('AudioWorklet wrapper accepts parameter/reset messages and reports invalid live ranges', async () => {
	assert.equal(AUDACITY_LIVE_WORKLET_NAME, 'kw-audacity-live-effect');
	const worklet = new AudacityLiveEffectProcessor({
		processorOptions: {
			effectType: 'audacity-echo', sampleRate: 1_000,
			params: { delaySeconds: 0.01, decay: 0.5 },
		},
	});
	const messages = [];
	worklet.port.postMessage = (message) => messages.push(message);
	await Promise.resolve();
	worklet.port.onmessage({ data: { type: 'params', params: { decay: 0.25 } } });
	assert.equal(messages.at(-1).type, 'status');
	assert.equal(messages.at(-1).status, 'updated');
	worklet.port.onmessage({ data: { type: 'params', params: { delaySeconds: 11 } } });
	assert.equal(messages.at(-1).type, 'error');
	assert.match(messages.at(-1).message, /live processing/);
	worklet.port.onmessage({ data: { type: 'reset' } });
	assert.equal(messages.at(-1).status, 'reset');

	const input = new Float32Array(32);
	input[0] = 1;
	const output = new Float32Array(32);
	assert.equal(worklet.process([[input]], [[output]]), true);
	assert.equal(output[0], 1);
	assert.equal(output[10], 0.25);
});
