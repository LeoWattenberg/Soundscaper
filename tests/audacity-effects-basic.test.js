import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyAudacityAmplify,
	applyAudacityAutoDuck,
	applyAudacityCompressor,
	applyAudacityFadeIn,
	applyAudacityFadeOut,
	applyAudacityInvert,
	applyAudacityLegacyCompressor,
	applyAudacityLimiter,
	applyAudacityLoudnessNormalization,
	applyAudacityNormalize,
	applyAudacityRepeat,
	applyAudacityReverse,
	applyAudacityTruncateSilence,
} from '../src/lib/tools/audio-editor/audacity-effects/basic.js';

const floats = (...values) => new Float32Array(values);

function closeTo(actual, expected, tolerance = 1e-6) {
	assert.equal(actual.length, expected.length);
	for (let index = 0; index < expected.length; index += 1) {
		assert.ok(
			Math.abs(actual[index] - expected[index]) <= tolerance,
			`sample ${index}: expected ${expected[index]}, received ${actual[index]}`,
		);
	}
}

function snapshot(channels) {
	return channels.map((channel) => Array.from(channel));
}

function unchanged(channels, before) {
	assert.deepEqual(channels.map((channel) => Array.from(channel)), before);
}

test('Amplify applies gain and prevents clipping against the linked selection peak', () => {
	const input = [floats(0.75, -0.5), floats(0.25, -0.25)];
	const before = snapshot(input);
	const guarded = applyAudacityAmplify(input, 48_000, { gainDb: 6, allowClipping: false });
	closeTo(guarded[0], [1, -2 / 3]);
	closeTo(guarded[1], [1 / 3, -1 / 3]);
	assert.notEqual(guarded[0], input[0]);
	const clipping = applyAudacityAmplify(input, 48_000, { gainDb: 6, allowClipping: true });
	assert.ok(clipping[0][0] > 1.49);
	unchanged(input, before);
});

test('Auto Duck uses the first control channel, a 100-sample RMS window, and dB fades', () => {
	const input = [floats(1, 1, 1, 1)];
	const control = [floats(1, 1, 0, 0), floats(0, 0, 0, 0)];
	const before = snapshot(input);
	const params = {
		duckAmountDb: -6,
		innerFadeDown: 0,
		innerFadeUp: 0,
		outerFadeDown: 0,
		outerFadeUp: 0,
		thresholdDb: -20,
		maximumPause: 0,
	};
	const output = applyAudacityAutoDuck(input, 100, params, control);
	closeTo(output[0], [1, 1, 10 ** (-6 / 20), 10 ** (-6 / 20)]);
	const secondControlOnly = applyAudacityAutoDuck(
		input,
		100,
		params,
		[floats(0, 0, 0, 0), floats(1, 1, 1, 1)],
	);
	closeTo(secondControlOnly[0], [1, 1, 1, 1]);
	unchanged(input, before);
	assert.throws(() => applyAudacityAutoDuck(input, 100, params), /control channel/i);
});

test('current Compressor derives one gain-reduction envelope from the linked channel maximum', () => {
	const input = [floats(0.1, 1, 0.1), floats(0.1, 0.1, 0.1)];
	const before = snapshot(input);
	const output = applyAudacityCompressor(input, 1_000, {
		thresholdDb: -6,
		makeupGainDb: 0,
		kneeWidthDb: 0,
		ratio: 2,
		lookaheadMs: 0,
		attackMs: 0,
		releaseMs: 0,
	});
	const compressedGain = 10 ** (-3 / 20);
	closeTo(output[0], [0.1, compressedGain, 0.1]);
	closeTo(output[1], [0.1, 0.1 * compressedGain, 0.1]);
	unchanged(input, before);
});

test('Limiter ports SimpleCompressor lookahead and applies its linked brick-wall envelope', () => {
	const input = [
		floats(0.1, 0.1, 1, 0.1, 0.1),
		floats(0.1, 0.1, 0.1, 0.1, 0.1),
	];
	const before = snapshot(input);
	const output = applyAudacityLimiter(input, 1_000, {
		thresholdDb: -6,
		makeupTargetDb: -6,
		kneeWidthDb: 0,
		lookaheadMs: 2,
		releaseMs: 0,
	});
	const limitedGain = 10 ** (-6 / 20);
	const rampGain = 10 ** (-3 / 20);
	closeTo(output[0], [0.1, 0.1 * rampGain, limitedGain, 0.1, 0.1]);
	closeTo(output[1], [0.1, 0.1 * rampGain, 0.1 * limitedGain, 0.1, 0.1]);
	unchanged(input, before);
});

test('Legacy Compressor keeps per-channel followers and uses one second-pass normalization peak', () => {
	const input = [floats(0.5, 0.5), floats(0.1, 0.1)];
	const before = snapshot(input);
	const params = {
		thresholdDb: -12,
		noiseFloorDb: -40,
		ratio: 2,
		attackSeconds: 0.1,
		releaseSeconds: 1,
		usePeak: true,
	};
	const unnormalized = applyAudacityLegacyCompressor(input, 100, {
		...params,
		normalize: false,
	});
	closeTo(unnormalized[0], [Math.sqrt(0.5), Math.sqrt(0.5)]);
	const normalized = applyAudacityLegacyCompressor(input, 100, {
		...params,
		normalize: true,
	});
	closeTo(normalized[0], [1, 1]);
	assert.ok(normalized[1][0] > 0.28 && normalized[1][0] < 0.29);
	assert.ok(normalized[1][0] < 1, 'the quieter channel must not normalize independently');
	unchanged(input, before);
});

test('Fade In and Fade Out retain Audacity linear endpoint behavior', () => {
	const input = [floats(1, 1, 1, 1)];
	const before = snapshot(input);
	closeTo(applyAudacityFadeIn(input, 48_000)[0], [0, 0.25, 0.5, 0.75]);
	closeTo(applyAudacityFadeOut(input, 48_000)[0], [0.75, 0.5, 0.25, 0]);
	unchanged(input, before);
});

test('Invert, Reverse, and Repeat return new deterministic channel arrays', () => {
	const input = [floats(1, -2, 3), floats(4, 5, 6)];
	const before = snapshot(input);
	closeTo(applyAudacityInvert(input, 48_000)[0], [-1, 2, -3]);
	closeTo(applyAudacityReverse(input, 48_000)[0], [3, -2, 1]);
	const repeated = applyAudacityRepeat(input, 48_000, { count: 2 });
	closeTo(repeated[0], [1, -2, 3, 1, -2, 3, 1, -2, 3]);
	closeTo(repeated[1], [4, 5, 6, 4, 5, 6, 4, 5, 6]);
	unchanged(input, before);
});

test('RMS Loudness Normalization supports linked and independent stereo gains', () => {
	const input = [floats(1, 1), floats(0.5, 0.5)];
	const before = snapshot(input);
	const targetRmsDb = 20 * Math.log10(0.5);
	const linked = applyAudacityLoudnessNormalization(input, 48_000, {
		mode: 'rms',
		targetRmsDb,
		targetLufs: -23,
		stereoIndependent: false,
		dualMono: true,
	});
	const linkedGain = 0.5 / Math.sqrt((1 ** 2 + 0.5 ** 2) / 2);
	closeTo(linked[0], [linkedGain, linkedGain]);
	closeTo(linked[1], [0.5 * linkedGain, 0.5 * linkedGain]);
	const independent = applyAudacityLoudnessNormalization(input, 48_000, {
		mode: 'rms',
		targetRmsDb,
		targetLufs: -23,
		stereoIndependent: true,
		dualMono: true,
	});
	closeTo(independent[0], [0.5, 0.5]);
	closeTo(independent[1], [0.5, 0.5]);
	unchanged(input, before);
});

test('EBU R128 Loudness Normalization implements Audacity dual-mono target power', () => {
	const sampleRate = 8_000;
	const inputChannel = new Float32Array(sampleRate);
	for (let index = 0; index < inputChannel.length; index += 1) {
		inputChannel[index] = 0.1 * Math.sin(2 * Math.PI * 440 * index / sampleRate);
	}
	const input = [inputChannel];
	const before = snapshot(input);
	const common = {
		mode: 'lufs',
		targetLufs: -23,
		targetRmsDb: -20,
		stereoIndependent: false,
	};
	const mono = applyAudacityLoudnessNormalization(input, sampleRate, {
		...common,
		dualMono: false,
	});
	const dualMono = applyAudacityLoudnessNormalization(input, sampleRate, {
		...common,
		dualMono: true,
	});
	assert.ok(Math.abs(mono[0][1]) > 0);
	assert.ok(Math.abs(dualMono[0][1] / mono[0][1] - Math.SQRT1_2) < 1e-6);
	const independentStereoWithoutDualMono = applyAudacityLoudnessNormalization(
		[inputChannel, inputChannel],
		sampleRate,
		{ ...common, stereoIndependent: true, dualMono: false },
	);
	const independentStereoWithDualMono = applyAudacityLoudnessNormalization(
		[inputChannel, inputChannel],
		sampleRate,
		{ ...common, stereoIndependent: true, dualMono: true },
	);
	closeTo(independentStereoWithDualMono[0], independentStereoWithoutDualMono[0]);
	unchanged(input, before);
});

test('Normalize removes per-channel DC and optionally links stereo peak gain', () => {
	const input = [floats(0, 2), floats(0, 0.5)];
	const before = snapshot(input);
	const linked = applyAudacityNormalize(input, 48_000, {
		peakDb: 0,
		removeDc: true,
		applyGain: true,
		stereoIndependent: false,
	});
	closeTo(linked[0], [-1, 1]);
	closeTo(linked[1], [-0.25, 0.25]);
	const independent = applyAudacityNormalize(input, 48_000, {
		peakDb: 0,
		removeDc: true,
		applyGain: true,
		stereoIndependent: true,
	});
	closeTo(independent[0], [-1, 1]);
	closeTo(independent[1], [-1, 1]);
	unchanged(input, before);
});

test('Truncate Silence finds silence linked across channels and crossfades centred cuts', () => {
	const input = [floats(1, 0, 0, 0, 0, 0, 0, 0, 0, 1)];
	const before = snapshot(input);
	const common = {
		thresholdDb: -20,
		minimumSilence: 0.5,
		truncateTo: 0.2,
		compressPercent: 50,
	};
	const truncated = applyAudacityTruncateSilence(input, 10, {
		...common,
		action: 'truncate',
	});
	closeTo(truncated[0], [0.75, 0, 0, 0.625]);
	const compressed = applyAudacityTruncateSilence(input, 10, {
		...common,
		action: 'compress',
	});
	assert.equal(compressed[0].length, 8);
	closeTo(compressed[0], [1, 0, 0, 0, 0, 0, 0, 0.875]);

	const secondChannelBreaksSilence = [input[0], floats(0, 0, 0, 0, 1, 0, 0, 0, 0, 0)];
	const linked = applyAudacityTruncateSilence(secondChannelBreaksSilence, 10, {
		...common,
		action: 'truncate',
	});
	assert.equal(linked[0].length, input[0].length);
	closeTo(linked[0], input[0]);
	unchanged(input, before);
});

test('basic effects validate audio shapes, sample rates, and manifest parameter ranges', () => {
	assert.throws(() => applyAudacityAmplify([], 48_000), /non-empty array/);
	assert.throws(() => applyAudacityAmplify([[1]], 48_000), /Float32Array/);
	assert.throws(
		() => applyAudacityAmplify([floats(1), floats(1, 2)], 48_000),
		/same length/,
	);
	assert.throws(() => applyAudacityAmplify([floats(1)], 0), /sampleRate/);
	assert.throws(() => applyAudacityRepeat([floats(1)], 48_000, { count: 0 }), /between 1 and 2147483647/);
});
