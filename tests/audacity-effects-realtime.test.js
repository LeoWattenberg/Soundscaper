import test from 'node:test';
import assert from 'node:assert/strict';

import {
	AUDACITY_CLASSIC_FILTER_FAMILIES,
	AUDACITY_DISTORTION_MODES,
	applyAudacityBassTreble,
	applyAudacityClassicFilter,
	applyAudacityDistortion,
	applyAudacityEcho,
	applyAudacityPhaser,
	applyAudacityWahwah,
} from '../src/common/editor/audacity-effects/realtime.js';
import { audacityEffectDefaults } from '../src/common/editor/audacity-effects/manifest.js';

const SAMPLE_RATE = 48_000;

function sine(frequency, frames = 12_000, amplitude = 0.5) {
	return Float32Array.from({ length: frames }, (_, index) => (
		amplitude * Math.sin(2 * Math.PI * frequency * index / SAMPLE_RATE)
	));
}

function mixedSignal(frames = 4_096) {
	return Float32Array.from({ length: frames }, (_, index) => (
		0.55 * Math.sin(2 * Math.PI * 317 * index / SAMPLE_RATE)
		+ 0.25 * Math.sin(2 * Math.PI * 5_731 * index / SAMPLE_RATE)
	));
}

function rms(samples, start = 0) {
	let sum = 0;
	for (let index = start; index < samples.length; index += 1) sum += samples[index] ** 2;
	return Math.sqrt(sum / Math.max(1, samples.length - start));
}

function maximumDifference(left, right) {
	let maximum = 0;
	for (let index = 0; index < left.length; index += 1) {
		maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
	}
	return maximum;
}

function assertFiniteChannels(channels, expectedLength) {
	for (const channel of channels) {
		assert.equal(channel instanceof Float32Array, true);
		assert.equal(channel.length, expectedLength);
		assert.equal(channel.every(Number.isFinite), true);
	}
}

function assertNear(actual, expected, tolerance = 1e-6) {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

test('one-shot Audacity effects validate channel data and never alias neutral output', () => {
	const left = Float32Array.of(-0.5, 0, 0.5);
	const right = Float32Array.of(0.25, 0, -0.25);
	const originalLeft = new Float32Array(left);
	const output = applyAudacityBassTreble([left, right], SAMPLE_RATE, {});

	assert.deepEqual(output, [left, right]);
	assert.notEqual(output[0], left);
	assert.notEqual(output[1], right);
	assert.deepEqual(left, originalLeft);
	assert.throws(() => applyAudacityEcho([], SAMPLE_RATE), /non-empty array/);
	assert.throws(() => applyAudacityEcho([new Float64Array(2)], SAMPLE_RATE), /Float32Array/);
	assert.throws(() => applyAudacityEcho([new Float32Array(2), new Float32Array(3)], SAMPLE_RATE), /same length/);
	assert.throws(() => applyAudacityEcho([left], 0), /sampleRate/);
});

test('streaming-compatible ports accept their manifest parameter contracts', () => {
	const input = mixedSignal(256);
	const effects = [
		['audacity-bass-treble', applyAudacityBassTreble],
		['audacity-distortion', applyAudacityDistortion],
		['audacity-echo', applyAudacityEcho],
		['audacity-phaser', applyAudacityPhaser],
		['audacity-classic-filters', applyAudacityClassicFilter],
		['audacity-wahwah', applyAudacityWahwah],
	];
	for (const [type, applyEffect] of effects) {
		const output = applyEffect([input], SAMPLE_RATE, audacityEffectDefaults(type));
		assertFiniteChannels(output, input.length);
	}
});

test('Bass and Treble preserves neutral audio and independently controls low and high bands', () => {
	const low = sine(100);
	const high = sine(8_000);
	assert.deepEqual(applyAudacityBassTreble([low], SAMPLE_RATE, {})[0], low);

	const lowBoosted = applyAudacityBassTreble([low], SAMPLE_RATE, { bassDb: 12 })[0];
	const lowCut = applyAudacityBassTreble([low], SAMPLE_RATE, { bassDb: -12 })[0];
	const highBoosted = applyAudacityBassTreble([high], SAMPLE_RATE, { trebleDb: 12 })[0];
	const highCut = applyAudacityBassTreble([high], SAMPLE_RATE, { trebleDb: -12 })[0];
	assert.ok(rms(lowBoosted, 2_000) > rms(lowCut, 2_000) * 3);
	assert.ok(rms(highBoosted, 2_000) > rms(highCut, 2_000) * 3);

	const volumeRaised = applyAudacityBassTreble([low], SAMPLE_RATE, { volumeDb: 6 })[0];
	assertNear(rms(volumeRaised, 2_000) / rms(low, 2_000), 10 ** (6 / 20), 2e-4);
});

test('Distortion implements all eleven Audacity waveshaper modes with finite, distinct output', () => {
	const input = Float32Array.from({ length: 257 }, (_, index) => (index - 128) / 100);
	const signatures = new Set();
	for (const mode of AUDACITY_DISTORTION_MODES) {
		const output = applyAudacityDistortion([input], SAMPLE_RATE, { mode })[0];
		assertFiniteChannels([output], input.length);
		signatures.add(Array.from(output.slice(40, 48), (value) => value.toFixed(6)).join(','));
	}
	assert.equal(signatures.size, AUDACITY_DISTORTION_MODES.length);
});

test('Distortion preserves Audacity hard clipping, rectifier, repeats, and DC-block behavior', () => {
	const clipped = applyAudacityDistortion(
		[Float32Array.of(-0.9, -0.25, 0, 0.25, 0.9)],
		SAMPLE_RATE,
		{ mode: 'hard-clipping', thresholdDb: -6, parameter1: 0, parameter2: 0, repeats: 0 },
	)[0];
	const threshold = 10 ** (-6 / 20);
	assertNear(clipped[0], -threshold);
	assertNear(clipped[1], -0.25);
	assert.equal(clipped[2], 0);
	assertNear(clipped[3], 0.25);
	assertNear(clipped[4], threshold);

	const fullWave = applyAudacityDistortion(
		[Float32Array.of(-0.75, -0.25, 0, 0.25, 0.75)],
		SAMPLE_RATE,
		{ mode: 'rectifier', parameter1: 100 },
	)[0];
	assert.deepEqual(Array.from(fullWave), [0.75, 0.25, 0, 0.25, 0.75]);

	const cubicOnce = applyAudacityDistortion([mixedSignal()], SAMPLE_RATE, {
		mode: 'cubic', parameter1: 80, parameter2: 100, repeats: 0,
	})[0];
	const cubicRepeated = applyAudacityDistortion([mixedSignal()], SAMPLE_RATE, {
		mode: 'cubic', parameter1: 80, parameter2: 100, repeats: 5,
	})[0];
	assert.ok(maximumDifference(cubicOnce, cubicRepeated) > 0.05);

	const constant = new Float32Array(128).fill(0.5);
	const dcBlocked = applyAudacityDistortion([constant], SAMPLE_RATE, {
		mode: 'hard-clipping', dcBlock: true, thresholdDb: 0, parameter1: 0, parameter2: 0,
	})[0];
	assert.ok(dcBlocked.every((sample) => Math.abs(sample) < 1e-7));
});

test('Echo uses Audacity recursive delay history without appending a tail', () => {
	const impulse = new Float32Array(31);
	impulse[0] = 1;
	const silent = new Float32Array(31);
	const [output, silentOutput] = applyAudacityEcho([impulse, silent], 1_000, {
		delaySeconds: 0.01,
		decay: 0.5,
	});

	assert.equal(output.length, impulse.length);
	assert.equal(output[0], 1);
	assert.equal(output[10], 0.5);
	assert.equal(output[20], 0.25);
	assert.equal(output[30], 0.125);
	assert.equal(output.filter((sample) => sample !== 0).length, 4);
	assert.deepEqual(silentOutput, silent);
	assert.deepEqual(applyAudacityEcho([impulse], 1_000, { delaySeconds: 0.01, decay: 0 })[0], impulse);
	const runaway = new Float32Array(64);
	runaway[0] = 1;
	assert.throws(
		() => applyAudacityEcho([runaway], 1_000, { delaySeconds: 0.001, decay: 10 }),
		/Echo produced a non-finite sample.*reduce Decay/,
	);
});

test('Phaser has exact dry and zero-depth invariants and responds to its LFO and feedback', () => {
	const input = mixedSignal(6_000);
	const dry = applyAudacityPhaser([input], SAMPLE_RATE, { dryWet: 0, outputGainDb: 0 })[0];
	const zeroDepthWet = applyAudacityPhaser([input], SAMPLE_RATE, {
		dryWet: 255, depth: 0, feedbackPercent: 0, outputGainDb: 0, stages: 24,
	})[0];
	assert.deepEqual(dry, input);
	assert.deepEqual(zeroDepthWet, input);

	const slow = applyAudacityPhaser([input], SAMPLE_RATE, {
		frequency: 0.1, depth: 255, dryWet: 255, outputGainDb: 0,
	})[0];
	const fastFeedback = applyAudacityPhaser([input], SAMPLE_RATE, {
		frequency: 4, depth: 255, dryWet: 255, feedbackPercent: 80, outputGainDb: 0,
	})[0];
	const twoStages = applyAudacityPhaser([input], SAMPLE_RATE, {
		stages: 2, depth: 255, dryWet: 255, outputGainDb: 0,
	})[0];
	const oddStages = applyAudacityPhaser([input], SAMPLE_RATE, {
		stages: 3, depth: 255, dryWet: 255, outputGainDb: 0,
	})[0];
	assertFiniteChannels([slow, fastFeedback], input.length);
	assert.ok(maximumDifference(slow, fastFeedback) > 0.1);
	assert.deepEqual(oddStages, twoStages);
});

test('Classic Filters produce finite impulses for every family, direction, and order extreme', () => {
	const impulse = new Float32Array(4_096);
	impulse[0] = 1;
	for (const family of AUDACITY_CLASSIC_FILTER_FAMILIES) {
		for (const direction of ['lowpass', 'highpass']) {
			for (const order of [1, 10]) {
				const output = applyAudacityClassicFilter([impulse], SAMPLE_RATE, {
					family, direction, order, cutoffHz: 2_000,
					passbandRippleDb: 1, stopbandAttenuationDb: 30,
				});
				assertFiniteChannels(output, impulse.length);
			}
		}
	}
});

test('Classic Filters separate passbands and expose the three Audacity filter families', () => {
	const lowTone = sine(100);
	const highTone = sine(8_000);
	const common = { family: 'butterworth', order: 6, cutoffHz: 1_000 };
	const lowpassLow = applyAudacityClassicFilter([lowTone], SAMPLE_RATE, { ...common, direction: 'lowpass' })[0];
	const lowpassHigh = applyAudacityClassicFilter([highTone], SAMPLE_RATE, { ...common, direction: 'lowpass' })[0];
	const highpassLow = applyAudacityClassicFilter([lowTone], SAMPLE_RATE, { ...common, direction: 'highpass' })[0];
	const highpassHigh = applyAudacityClassicFilter([highTone], SAMPLE_RATE, { ...common, direction: 'highpass' })[0];
	assert.ok(rms(lowpassLow, 4_000) > rms(lowpassHigh, 4_000) * 1_000);
	assert.ok(rms(highpassHigh, 4_000) > rms(highpassLow, 4_000) * 1_000);

	const familyOutputs = AUDACITY_CLASSIC_FILTER_FAMILIES.map((family) => (
		applyAudacityClassicFilter([mixedSignal()], SAMPLE_RATE, {
			family, direction: 'lowpass', order: 4, cutoffHz: 2_000,
		})[0]
	));
	assert.ok(maximumDifference(familyOutputs[0], familyOutputs[1]) > 0.01);
	assert.ok(maximumDifference(familyOutputs[1], familyOutputs[2]) > 0.01);
});

test('Wahwah remains finite and responds to phase, depth, offset, resonance, and output gain', () => {
	const input = mixedSignal(8_000);
	const quiet = applyAudacityWahwah([input], SAMPLE_RATE, {
		frequency: 0.1,
		phaseDegrees: 0,
		depthPercent: 0,
		resonance: 0.1,
		frequencyOffsetPercent: 10,
		outputGainDb: -6,
	})[0];
	const loudModulated = applyAudacityWahwah([input], SAMPLE_RATE, {
		frequency: 4,
		phaseDegrees: 180,
		depthPercent: 100,
		resonance: 10,
		frequencyOffsetPercent: 90,
		outputGainDb: 6,
	})[0];
	assertFiniteChannels([quiet, loudModulated], input.length);
	assert.ok(maximumDifference(quiet, loudModulated) > 0.1);

	const gainLow = applyAudacityWahwah([input], SAMPLE_RATE, { outputGainDb: -6 })[0];
	const gainHigh = applyAudacityWahwah([input], SAMPLE_RATE, { outputGainDb: 6 })[0];
	assertNear(rms(gainHigh, 2_000) / rms(gainLow, 2_000), 10 ** (12 / 20), 2e-5);
});
