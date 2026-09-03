import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BITCRUSHER_DITHER_MODES,
	BITCRUSHER_INTERPOLATION_MODES,
	applyBitcrusher,
	createBitcrusherProcessor,
} from '../src/common/editor/first-party-effects/bitcrusher/dsp.js';
import {
	AUDIO_EFFECT_DEFINITIONS,
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	audioEffectParamChoices,
	createEffect,
} from '../src/common/editor/effects.js';
import { EFFECT_MENU_GROUPS } from '../src/common/editor/ui/application-menu-model.js';

const SAMPLE_RATE = 48_000;

function ramp(length) {
	return Float32Array.from({ length }, (unused, index) => -1 + (2 * index) / (length - 1));
}

function tone(length, hertz = 997, amplitude = 0.5) {
	return Float32Array.from({ length }, (unused, index) => (
		Math.sin((2 * Math.PI * hertz * index) / SAMPLE_RATE) * amplitude
	));
}

function crush(channels, params) {
	return applyBitcrusher(channels, SAMPLE_RATE, {
		bitDepth: 8, dither: 'none', downsampling: 1, interpolation: 'sample-hold', mix: 100, ...params,
	});
}

test('bit depth resolves the signal onto exactly two-to-the-N symmetric levels', () => {
	for (const bitDepth of [1, 2, 3, 4, 6, 8]) {
		const output = crush([ramp(4_096)], { bitDepth })[0];
		const levels = [...new Set(output)].sort((first, second) => first - second);
		assert.equal(levels.length, 2 ** bitDepth, `bit depth ${bitDepth}`);
		// Mid-rise: no level sits on zero, and the grid mirrors about it.
		for (const level of levels) assert.ok(levels.some((other) => Math.abs(other + level) < 1e-9));
		assert.ok(levels.every((level) => Math.abs(level) <= 1));
	}
});

test('one bit degrades to a clean half-scale square rather than collapsing', () => {
	const input = ramp(512);
	const output = crush([input], { bitDepth: 1 })[0];
	assert.deepEqual([...new Set(output)].sort((first, second) => first - second), [-0.5, 0.5]);
	for (let frame = 0; frame < input.length; frame += 1) {
		assert.equal(output[frame], input[frame] < 0 ? -0.5 : 0.5);
	}
});

test('a fully dry mix is a bit-exact passthrough whatever else is set', () => {
	const input = tone(2_048);
	const output = crush([input], {
		bitDepth: 2, dither: 'shaped', downsampling: 12, interpolation: 'cubic', mix: 0,
	})[0];
	assert.deepEqual(output, input);
});

test('sample rate reduction holds each captured value for the whole interval', () => {
	const input = Float32Array.from({ length: 24 }, (unused, index) => (index + 1) / 64);
	const output = crush([input], { bitDepth: 16, downsampling: 4 })[0];
	for (let frame = 0; frame < input.length; frame += 1) {
		// Captures land on multiples of the hold length, and nothing moves between them.
		assert.equal(output[frame], output[frame - (frame % 4)], `frame ${frame}`);
	}
	assert.equal(new Set(output).size, input.length / 4);
});

test('sample and hold is a staircase while the smoother modes move within the interval', () => {
	const input = tone(1_024, 220, 0.9);
	const held = crush([input], { downsampling: 16, interpolation: 'sample-hold' })[0];
	for (let frame = 0; frame < held.length; frame += 1) {
		assert.equal(held[frame], held[frame - (frame % 16)], `held frame ${frame}`);
	}
	for (const interpolation of ['linear', 'cubic', 'smooth']) {
		const output = crush([input], { downsampling: 16, interpolation })[0];
		const movesWithinInterval = output.some((value, frame) => (
			frame % 16 !== 0 && value !== output[frame - (frame % 16)]
		));
		assert.ok(movesWithinInterval, interpolation);
		assert.ok(output.every((value) => Number.isFinite(value) && Math.abs(value) <= 1), interpolation);
	}
});

test('every reconstruction mode reaches the newly held value with no decimation', () => {
	const input = tone(256, 400, 0.7);
	const reference = crush([input], { downsampling: 1, interpolation: 'sample-hold' })[0];
	for (const interpolation of ['linear', 'cubic']) {
		// At a hold length of one there is no interval to smooth across, so the
		// smoothing modes must not introduce a delay against plain quantization.
		assert.deepEqual(crush([input], { downsampling: 1, interpolation })[0], reference, interpolation);
	}
});

test('dither trades a larger uncorrelated error for a decorrelated one, and stays bounded', () => {
	const input = tone(24_000);
	const errorFor = (dither) => {
		const output = crush([input], { bitDepth: 6, dither })[0];
		assert.ok(output.every((value) => Number.isFinite(value) && Math.abs(value) <= 1), dither);
		let total = 0;
		for (let frame = 0; frame < input.length; frame += 1) total += (output[frame] - input[frame]) ** 2;
		return Math.sqrt(total / input.length);
	};
	const undithered = errorFor('none');
	for (const dither of BITCRUSHER_DITHER_MODES.filter((mode) => mode !== 'none')) {
		assert.ok(errorFor(dither) > undithered, `${dither} should cost noise`);
	}
	// Shaped feedback is the loudest of them and must still not run away.
	assert.ok(errorFor('shaped') < 1);
});

test('rendering is reproducible and decorrelated across channels', () => {
	const left = tone(4_096, 997);
	const right = tone(4_096, 997);
	const params = { bitDepth: 5, dither: 'triangular' };
	const first = crush([left, right], params);
	const second = crush([left, right], params);
	assert.deepEqual(first[0], second[0]);
	assert.deepEqual(first[1], second[1]);
	// Identical input, independent noise: correlated dither would collapse to
	// the centre of the stereo image.
	assert.notDeepEqual(first[0], first[1]);
});

test('malformed selections are rejected before any processing', () => {
	assert.throws(() => applyBitcrusher([], SAMPLE_RATE, {}), TypeError);
	assert.throws(() => applyBitcrusher([[0, 1, 2]], SAMPLE_RATE, {}), TypeError);
	assert.throws(
		() => applyBitcrusher([new Float32Array(4), new Float32Array(5)], SAMPLE_RATE, {}),
		RangeError,
	);
	assert.throws(() => createBitcrusherProcessor({ channelCount: 0, params: {} }), RangeError);
	assert.throws(() => createBitcrusherProcessor({ channelCount: 33, params: {} }), RangeError);
});

test('the input selection is never mutated', () => {
	const input = tone(512);
	const copy = Float32Array.from(input);
	crush([input], { bitDepth: 3, dither: 'triangular', downsampling: 5 });
	assert.deepEqual(input, copy);
});

test('the bitcrusher is offered as both a rack insert and a destructive selection effect', () => {
	assert.ok(AUDIO_EFFECT_DEFINITIONS.bitcrusher);
	assert.ok(AUDIO_SELECTION_EFFECT_DEFINITIONS.bitcrusher);
	const distortion = EFFECT_MENU_GROUPS.find(([group]) => group === 'distortionModulation');
	assert.ok(distortion[1].includes('bitcrusher'));
});

test('named parameter choices are validated and numeric ones are clamped to whole bits', () => {
	assert.deepEqual(audioEffectParamChoices('bitcrusher', 'dither'), [...BITCRUSHER_DITHER_MODES]);
	assert.deepEqual(
		audioEffectParamChoices('bitcrusher', 'interpolation'),
		[...BITCRUSHER_INTERPOLATION_MODES],
	);
	assert.equal(audioEffectParamChoices('bitcrusher', 'bitDepth'), null);
	assert.equal(createEffect('bitcrusher').params.dither, 'none');
	assert.equal(createEffect('bitcrusher', { params: { bitDepth: 7.6 } }).params.bitDepth, 8);
	assert.throws(() => createEffect('bitcrusher', { params: { dither: 'gaussian' } }), RangeError);
	assert.throws(() => createEffect('bitcrusher', { params: { bitDepth: 17 } }), RangeError);
	assert.throws(() => createEffect('bitcrusher', { params: { downsampling: 0.5 } }), RangeError);
});
