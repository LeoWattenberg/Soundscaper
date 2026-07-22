import test from 'node:test';
import assert from 'node:assert/strict';

import {
	applyAudacityClickRemoval,
	applyAudacityFilterCurveEq,
	applyAudacityGraphicEq,
	applyAudacityNoiseReduction,
	applyAudacityPaulstretch,
	applyAudacityRepair,
	captureAudacityNoiseProfile,
} from '../src/common/editor/audacity-effects/spectral.js';
import { initializePffft } from '../src/common/editor/pffft.js';

await initializePffft();

const GRAPHIC_BANDS = 31;

test('Click Removal interpolates narrow spikes, preserves broad events, and never mutates input', () => {
	const input = new Float32Array(9_000).fill(0.01);
	input[4_500] = 1;
	input[4_501] = -0.8;
	const original = new Float32Array(input);
	const [output] = applyAudacityClickRemoval([input], 8_000, { threshold: 200, maximumWidth: 20 });

	assert.notStrictEqual(output, input);
	assert.deepEqual(input, original);
	assert.ok(Math.abs(output[4_500] - 0.01) < 1e-6);
	assert.ok(Math.abs(output[4_501] - 0.01) < 1e-6);
	assert.ok(peak(output) < 0.011);

	const broad = new Float32Array(9_000).fill(0.01);
	broad.fill(0.8, 4_400, 4_500);
	assert.deepEqual(
		applyAudacityClickRemoval([broad], 8_000, { threshold: 200, maximumWidth: 20 })[0],
		broad,
	);
});

test('Click Removal honors Audacity skip and minimum-selection constraints', () => {
	const short = Float32Array.of(0, 1, 0);
	const [skipped] = applyAudacityClickRemoval([short], 8_000, { threshold: 0, maximumWidth: 20 });
	assert.deepEqual(skipped, short);
	assert.notStrictEqual(skipped, short);
	assert.throws(
		() => applyAudacityClickRemoval([new Float32Array(4_096)], 8_000),
		/more than 4096 samples/,
	);
});

test('Filter Curve EQ implements aligned Blackman-windowed FIR gain and flat identity', () => {
	const input = sine(8_192, 8_000, 1_000, 0.2);
	const original = new Float32Array(input);
	const flat = applyAudacityFilterCurveEq([input], 8_000, {
		points: [{ frequency: 20, gain: 0 }, { frequency: 20_000, gain: 0 }],
		filterLength: 101,
	})[0];
	assert.ok(maxDifference(flat, input) < 1e-6);
	assert.deepEqual(input, original);
	assert.notStrictEqual(flat, input);

	const boosted = applyAudacityFilterCurveEq([input], 8_000, {
		points: [
			{ frequency: 20, gain: 0 },
			{ frequency: 500, gain: 0 },
			{ frequency: 1_000, gain: 12 },
			{ frequency: 2_000, gain: 0 },
			{ frequency: 20_000, gain: 0 },
		],
		filterLength: 1_001,
	})[0];
	const attenuated = applyAudacityFilterCurveEq([input], 8_000, {
		points: [
			{ frequency: 20, gain: 0 },
			{ frequency: 500, gain: 0 },
			{ frequency: 1_000, gain: -12 },
			{ frequency: 2_000, gain: 0 },
			{ frequency: 20_000, gain: 0 },
		],
		filterLength: 1_001,
	})[0];
	const inputRms = rms(input, 1_000, 7_192);
	assert.ok(between(rms(boosted, 1_000, 7_192) / inputRms, 3.8, 4.1));
	assert.ok(between(rms(attenuated, 1_000, 7_192) / inputRms, 0.23, 0.3));
});

test('Filter Curve EQ supports Audacity empty/single curves, linear scale, and contract validation', () => {
	const input = sine(8_192, 8_000, 500, 0.2);
	const flat = applyAudacityFilterCurveEq([input], 8_000, { points: [], filterLength: 101 })[0];
	assert.ok(maxDifference(flat, input) < 1e-6);
	const constant = applyAudacityFilterCurveEq([input], 8_000, {
		points: [{ frequency: 1_000, gain: 6 }], filterLength: 101,
	})[0];
	assert.ok(between(rms(constant, 1_000, 7_192) / rms(input, 1_000, 7_192), 1.9, 2.1));

	const curve = [
		{ frequency: 20, gain: 0 },
		{ frequency: 1_000, gain: 12 },
		{ frequency: 4_000, gain: 0 },
	];
	const logarithmic = applyAudacityFilterCurveEq([input], 8_000, {
		points: curve, linearFrequencyScale: false, filterLength: 1_001,
	})[0];
	const linear = applyAudacityFilterCurveEq([input], 8_000, {
		points: curve, linearFrequencyScale: true, filterLength: 1_001,
	})[0];
	assert.ok(rms(logarithmic, 1_000, 7_192) > rms(linear, 1_000, 7_192) * 1.25);

	assert.throws(
		() => applyAudacityFilterCurveEq([input], 8_000, {
			points: [{ frequency: 100, gain: 0 }, { frequency: 100, gain: 3 }],
		}),
		/frequencies must be unique/,
	);
	assert.throws(
		() => applyAudacityFilterCurveEq([input], 8_000, { filterLength: 9 }),
		/must be between 21 and 8191/,
	);
});

test('Graphic EQ implements Audacity B-spline, cosine, and cubic band interpolation', () => {
	const input = sine(8_192, 8_000, 1_000, 0.2);
	const flatGains = Array(GRAPHIC_BANDS).fill(0);
	const flat = applyAudacityGraphicEq([input], 8_000, {
		gains: flatGains,
		interpolation: 'bspline',
		filterLength: 101,
	})[0];
	assert.ok(maxDifference(flat, input) < 1e-6);

	const gains = Array(GRAPHIC_BANDS).fill(0);
	gains[17] = 12; // 1 kHz third-octave band
	const ratios = {};
	for (const interpolation of ['bspline', 'cosine', 'cubic']) {
		const output = applyAudacityGraphicEq([input], 8_000, {
			gains,
			interpolation,
			filterLength: 1_001,
		})[0];
		ratios[interpolation] = rms(output, 1_000, 7_192) / rms(input, 1_000, 7_192);
		assert.ok(output.every(Number.isFinite));
	}
	assert.ok(between(ratios.bspline, 2.7, 2.9));
	assert.ok(between(ratios.cosine, 3.85, 4.1));
	assert.ok(between(ratios.cubic, 3.85, 4.1));
	assert.notEqual(ratios.bspline, ratios.cosine);
	assert.throws(
		() => applyAudacityGraphicEq([input], 8_000, { gains: [0, 0] }),
		/requires 31 band gains/,
	);
});

test('Noise Reduction captures Audacity-style mean spectra and suppresses matching noise deterministically', () => {
	const noise = deterministicNoise(4_096, 0.2, 1234);
	const original = new Float32Array(noise);
	const profile = captureAudacityNoiseProfile([noise], 8_000);
	assert.equal(profile.type, 'audacity-noise-profile');
	assert.equal(profile.windowSize, 2_048);
	assert.equal(profile.stepsPerWindow, 4);
	assert.equal(profile.windowCount, 5);
	assert.equal(profile.meanPowers.length, 1_025);
	assert.ok(profile.meanPowers.some((power) => power > 0));

	const params = { reductionDb: 12, sensitivity: 6, frequencySmoothingBands: 6, output: 'reduce' };
	const reduced = applyAudacityNoiseReduction([noise], 8_000, params, profile)[0];
	const repeated = applyAudacityNoiseReduction([noise], 8_000, params, profile)[0];
	assert.deepEqual(reduced, repeated);
	assert.ok(rms(reduced) / rms(noise) < 0.35);
	assert.deepEqual(noise, original);
	assert.notStrictEqual(reduced, noise);
});

test('Noise Reduction residue has Audacity polarity and complements reduced output', () => {
	const noise = deterministicNoise(4_096, 0.15, 99);
	const profile = captureAudacityNoiseProfile([noise], 8_000);
	const baseParams = { reductionDb: 9, sensitivity: 5, frequencySmoothingBands: 3 };
	const reduced = applyAudacityNoiseReduction([noise], 8_000, { ...baseParams, output: 'reduce' }, profile)[0];
	const residue = applyAudacityNoiseReduction([noise], 8_000, { ...baseParams, output: 'residue' }, profile)[0];
	let reconstructionError = 0;
	for (let frame = 0; frame < noise.length; frame += 1) {
		reconstructionError = Math.max(reconstructionError, Math.abs(reduced[frame] - residue[frame] - noise[frame]));
	}
	assert.ok(reconstructionError < 1e-7);

	const unity = applyAudacityNoiseReduction([noise], 8_000, { ...baseParams, reductionDb: 0, output: 'reduce' }, profile)[0];
	const emptyResidue = applyAudacityNoiseReduction([noise], 8_000, { ...baseParams, reductionDb: 0, output: 'residue' }, profile)[0];
	assert.deepEqual(unity, noise);
	assert.deepEqual(emptyResidue, new Float32Array(noise.length));
});

test('Noise Reduction rejects short, mismatched, and malformed profiles', () => {
	assert.throws(
		() => captureAudacityNoiseProfile([new Float32Array(2_047)], 8_000),
		/at least 2048 samples/,
	);
	const noise = deterministicNoise(2_048, 0.1, 1);
	const profile = captureAudacityNoiseProfile([noise], 8_000);
	assert.throws(
		() => applyAudacityNoiseReduction([noise], 16_000, {}, profile),
		/sample rate must match/,
	);
	assert.throws(
		() => applyAudacityNoiseReduction([noise], 8_000, {}, { ...profile, meanPowers: [...profile.meanPowers] }),
		/spectrum is invalid/,
	);
	assert.throws(
		() => applyAudacityNoiseReduction([noise], 8_000, {}, null),
		/noise profile captured/,
	);
});

test('Paulstretch performs seeded random-phase stretching at an exact output length', () => {
	const input = sine(2_048, 8_000, 440, 0.3);
	const original = new Float32Array(input);
	const params = { stretchFactor: 2, timeResolution: 0.01 };
	const first = applyAudacityPaulstretch([input], 8_000, params, { seed: 'session-a' })[0];
	const repeated = applyAudacityPaulstretch([input], 8_000, params, { seed: 'session-a' })[0];
	const different = applyAudacityPaulstretch([input], 8_000, params, { seed: 'session-b' })[0];

	assert.equal(first.length, 4_096);
	assert.deepEqual(first, repeated);
	assert.ok(maxDifference(first, different) > 1e-3);
	assert.ok(first.every(Number.isFinite));
	assert.ok(rms(first) > 0.03);
	assert.equal(first[0], input[0]);
	assert.equal(first.at(-1), input.at(-1));
	assert.deepEqual(input, original);
	assert.notStrictEqual(first, input);
});

test('Paulstretch enforces time-resolution selection and manifest bounds', () => {
	assert.throws(
		() => applyAudacityPaulstretch([new Float32Array(256)], 8_000, {
			stretchFactor: 2,
			timeResolution: 0.001,
		}),
		/at least 257 samples/,
	);
	assert.throws(
		() => applyAudacityPaulstretch([new Float32Array(512)], 8_000, {
			stretchFactor: 0.5,
			timeResolution: 0.001,
		}),
		/stretchFactor must be between 1 and/,
	);
});

test('Repair reconstructs short missing sine sections with deterministic LSAR', () => {
	const complete = sine(264, 8_000, 440, 0.3);
	const before = complete.slice(0, 128);
	const expected = complete.slice(128, 136);
	const after = complete.slice(136);
	const damaged = new Float32Array(expected.length);
	const beforeOriginal = new Float32Array(before);
	const afterOriginal = new Float32Array(after);
	const first = applyAudacityRepair([damaged], 8_000, {}, {
		beforeChannels: [before],
		afterChannels: [after],
	})[0];
	const repeated = applyAudacityRepair([damaged], 8_000, {}, {
		beforeChannels: [before],
		afterChannels: [after],
	})[0];

	assert.deepEqual(first, repeated);
	assert.ok(rmsDifference(first, expected) < 2e-5);
	assert.deepEqual(damaged, new Float32Array(expected.length));
	assert.deepEqual(before, beforeOriginal);
	assert.deepEqual(after, afterOriginal);
});

test('Repair falls back to linear interpolation with little context and validates context', () => {
	const damaged = Float32Array.of(99, 99);
	const repaired = applyAudacityRepair([damaged], 48_000, {}, {
		beforeChannels: [Float32Array.of(0)],
		afterChannels: [Float32Array.of(3)],
	})[0];
	assert.deepEqual(repaired, Float32Array.of(1, 2));
	assert.throws(
		() => applyAudacityRepair([new Float32Array(129)], 48_000, {}, {
			beforeChannels: [Float32Array.of(0)],
		}),
		/at most 128 samples/,
	);
	assert.throws(
		() => applyAudacityRepair([new Float32Array(2)], 48_000),
		/audio touching at least one side/,
	);
	assert.throws(
		() => applyAudacityRepair([new Float32Array(2), new Float32Array(2)], 48_000, {}, {
			beforeChannels: [Float32Array.of(0)],
		}),
		/must contain 2 channels/,
	);
});

test('spectral processors reject malformed channel selections and non-finite audio', () => {
	assert.throws(
		() => applyAudacityFilterCurveEq([new Float64Array(32)], 48_000),
		/must be a Float32Array/,
	);
	assert.throws(
		() => applyAudacityGraphicEq([new Float32Array(3), new Float32Array(4)], 48_000),
		/same frame count/,
	);
	assert.throws(
		() => captureAudacityNoiseProfile([Float32Array.of(0, Number.NaN)], 48_000),
		/must be finite/,
	);
	assert.throws(
		() => applyAudacityClickRemoval([new Float32Array(5_000)], 0),
		/sampleRate must be a positive finite number/,
	);
});

function sine(length, sampleRate, frequency, amplitude = 1) {
	return Float32Array.from(
		{ length },
		(_, frame) => amplitude * Math.sin(2 * Math.PI * frequency * frame / sampleRate),
	);
}

function deterministicNoise(length, amplitude, seed) {
	let state = seed >>> 0;
	return Float32Array.from({ length }, () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return ((state >>> 0) / 4_294_967_296 - 0.5) * amplitude;
	});
}

function rms(values, start = 0, end = values.length) {
	let sum = 0;
	for (let index = start; index < end; index += 1) sum += values[index] ** 2;
	return Math.sqrt(sum / (end - start));
}

function rmsDifference(left, right) {
	let sum = 0;
	for (let index = 0; index < left.length; index += 1) sum += (left[index] - right[index]) ** 2;
	return Math.sqrt(sum / left.length);
}

function maxDifference(left, right) {
	let maximum = 0;
	for (let index = 0; index < left.length; index += 1) maximum = Math.max(maximum, Math.abs(left[index] - right[index]));
	return maximum;
}

function peak(values) {
	let maximum = 0;
	for (const value of values) maximum = Math.max(maximum, Math.abs(value));
	return maximum;
}

function between(value, minimum, maximum) {
	return value >= minimum && value <= maximum;
}
