/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	addMultiplyDivideRationals,
	addRationals,
	beatToSampleFrame,
	composeRationalRates,
	countInSampleFrames,
	evaluateBreakpointMap,
	multiplyDivideRationals,
	normalizeRational,
	roundRational,
	sampleFrameToVideoFrame,
	secondsToSampleFrame,
	validateBreakpointMap,
	videoFrameRangeToSampleRange,
	videoFrameToSampleFrame,
} from '../src/common/editor/timeline-time.ts';

test('named rounding policies define ties, negatives, enclosing ranges, and direction', () => {
	assert.equal(roundRational(3, 2, 'point'), 2);
	assert.equal(roundRational(-3, 2, 'point'), -2);
	assert.equal(roundRational(1, 2, 'point'), 1);
	assert.equal(roundRational(-1, 2, 'point'), -1);
	assert.equal(roundRational(-3, 2, 'enclosingStart'), -2);
	assert.equal(roundRational(-3, 2, 'enclosingEnd'), -1);
	assert.equal(roundRational(3, 2, 'directional', 'previous'), 1);
	assert.equal(roundRational(3, 2, 'directional', 'next'), 2);
	assert.throws(() => roundRational(1, 2, 'directional'), /direction/iu);
});

test('44.1 kHz at 24 fps exercises half-away ties and absolute-origin extents', () => {
	const rate = { num: 24, den: 1 };
	assert.equal(videoFrameToSampleFrame(1, rate, 44_100), 1_838);
	assert.equal(videoFrameToSampleFrame(-1, rate, 44_100), -1_838);
	assert.deepEqual(videoFrameRangeToSampleRange(0, 1, rate, 44_100), {
		startFrame: 0,
		endFrame: 1_838,
		durationFrames: 1_838,
	});
	assert.deepEqual(videoFrameRangeToSampleRange(1, 1, rate, 44_100), {
		startFrame: 1_838,
		endFrame: 3_675,
		durationFrames: 1_837,
	});
});

test('standard rational video boundaries round-trip without cumulative drift', () => {
	for (const rate of [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30_000, den: 1_001 }]) {
		for (let frame = -10_000; frame <= 10_000; frame += 137) {
			const sample = videoFrameToSampleFrame(frame, rate, 48_000);
			assert.equal(sampleFrameToVideoFrame(sample, rate, 48_000), frame);
		}
	}
});

test('rational composition reduces before evaluation and rejects unsafe results', () => {
	assert.deepEqual(composeRationalRates(
		{ num: 30_000, den: 1_001 },
		{ num: 24_000, den: 1_001 },
	), { num: 720_000_000, den: 1_002_001 });
	assert.deepEqual(normalizeRational({ num: -20, den: -30 }), { num: 2, den: 3 });
	assert.deepEqual(addRationals({ num: 1, den: 3 }, { num: 1, den: 6 }), { num: 1, den: 2 });
	assert.deepEqual(multiplyDivideRationals(1_000_000_000, 1_000_000_000, 1_000_000_000), {
		num: 1_000_000_000, den: 1,
	}, 'cross cancellation occurs before the public safe-integer boundary');
	assert.throws(
		() => multiplyDivideRationals(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 1),
		/safe integer domain/iu,
	);
	const wide = 9_007_199_253_999_999;
	assert.deepEqual(addMultiplyDivideRationals(
		{ num: 1, den: 1_000_000 },
		{ num: 1, den: wide },
		{ num: 1, den: 1_000_000 },
		1,
	), { num: 9_007_199_254, den: wide },
	'one affine reduction keeps a safe final coordinate when the product alone is not public');
	assert.throws(
		() => videoFrameToSampleFrame(Number.MAX_SAFE_INTEGER, { num: 1, den: 1 }, 768_000),
		/safe integer/iu,
	);
});

test('seconds and hold-tempo beats use named point conversion from the origin', () => {
	assert.equal(secondsToSampleFrame(0.5, 44_100, 'point'), 22_050);
	assert.equal(secondsToSampleFrame(-0.5, 44_100, 'point'), -22_050);
	assert.throws(() => secondsToSampleFrame(Number.NaN, 44_100), /seconds must be finite/iu);
	assert.equal(
		secondsToSampleFrame(187.825, 44_100, 'point'),
		secondsToSampleFrame({ num: 7_513, den: 40 }, 44_100, 'point'),
		'equivalent decimal and rational inputs must share exact tie behavior',
	);
	const tempoMap = {
		mode: 'musical' as const,
		events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } },
			{ beat: { num: 4, den: 1 }, bpm: { num: 60, den: 1 } },
		],
	};
	assert.equal(beatToSampleFrame({ num: 4, den: 1 }, tempoMap, 48_000), 96_000);
	assert.equal(beatToSampleFrame({ num: 5, den: 1 }, tempoMap, 48_000), 144_000);
});

test('composed rational rates remain consumable by exact frame conversion', () => {
	const rate = composeRationalRates(
		{ num: 30_000, den: 1_001 },
		{ num: 24_000, den: 1_001 },
	);
	assert.deepEqual(rate, { num: 720_000_000, den: 1_002_001 });
	assert.equal(videoFrameToSampleFrame(1, rate, 48_000), 67);
});

test('count-in measures honor the signature denominator', () => {
	assert.equal(countInSampleFrames(1, {
		bpm: { num: 120, den: 1 },
		timeSignature: { numerator: 6, denominator: 8 },
	}, 48_000), 72_000);
	assert.equal(countInSampleFrames(2, {
		bpm: { num: 120, den: 1 },
		timeSignature: { numerator: 3, denominator: 4 },
	}, 48_000), 144_000);
	assert.throws(() => countInSampleFrames(1, {
		bpm: { num: 120, den: 1 },
		timeSignature: { numerator: 4, denominator: 2 ** 32 + 1 },
	}, 48_000), /denominator/iu);
	assert.equal(countInSampleFrames(1, {
		bpm: { num: 120, den: 1 },
		timeSignature: { numerator: 4, denominator: 2 ** 32 },
	}, 48_000), 0, 'the exact check must not reject a large genuine power of two');
});

test('shared breakpoint maps enforce audio and video direction semantics', () => {
	const audio = {
		feature: 'audio-warp' as const,
		points: [
			{ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' as const },
			{ outer: { num: 2, den: 1 }, source: { num: 3, den: 1 }, mode: 'forward' as const },
		],
	};
	assert.equal(validateBreakpointMap(audio), true);
	assert.deepEqual(evaluateBreakpointMap(audio, { num: 1, den: 1 }), { num: 3, den: 2 });
	assert.throws(() => validateBreakpointMap({
		feature: 'audio-warp',
		points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 1, source: 0, mode: 'freeze' },
		],
	}), /audio.*increasing/iu);

	const video = {
		feature: 'video-retime' as const,
		points: [
			{ outer: 0, source: 4, mode: 'reverse' as const },
			{ outer: 2, source: 2, mode: 'freeze' as const },
			{ outer: 3, source: 2, mode: 'forward' as const },
			{ outer: 5, source: 6, mode: 'forward' as const },
		],
	};
	assert.equal(validateBreakpointMap(video), true);
	assert.deepEqual(evaluateBreakpointMap(video, 1), { num: 3, den: 1 });
	assert.deepEqual(evaluateBreakpointMap(video, { num: 5, den: 2 }), { num: 2, den: 1 });
});
