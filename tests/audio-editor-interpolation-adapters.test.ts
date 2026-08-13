/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEnvelopeValueEvaluator } from '../src/common/editor/automation.js';
import {
	compileBreakpointInterpolationAdapter,
	compileBreakpointInterpolationCurve,
	compileEnvelopeInterpolationCurve,
	compileVideoRetimeInterpolationAdapter,
	compileVideoRetimeInterpolationCurve,
	evaluateBreakpointInterpolationAdapter,
	evaluateVideoRetimeInterpolationAdapter,
} from '../src/common/editor/interpolation-adapters.ts';
import { evaluateInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import { evaluateBreakpointMap } from '../src/common/editor/timeline-time.ts';
import {
	compileVideoRetimeCurve,
	evaluateVideoRetimeCurve,
} from '../src/common/editor/video-retime-curve.ts';

const rational = (num: number, den = 1) => ({ num, den });

test('legacy envelope interpolation is a linear vocabulary subset with unity endpoints', () => {
	const points = [
		{ frame: 4, value: 0.5 },
		{ frame: 10, value: 1.5 },
		{ frame: 16, value: 0.25 },
	];
	const expected = createEnvelopeValueEvaluator(points, 20);
	const curve = compileEnvelopeInterpolationCurve(points, 20);
	assert.equal(evaluateInterpolationCurve(curve, -5), expected(0), 'the shared evaluator clamps before the clip');
	for (const frame of [0, 2, 4, 7, 10, 13, 16, 18, 20, 25]) {
		assert.equal(evaluateInterpolationCurve(curve, frame), expected(frame), `frame ${String(frame)}`);
	}
	const unity = compileEnvelopeInterpolationCurve([], 20);
	assert.equal(evaluateInterpolationCurve(unity, 0), 1);
	assert.equal(evaluateInterpolationCurve(unity, 10), 1);
	assert.equal(evaluateInterpolationCurve(unity, 20), 1);
});

test('legacy envelope adapter preserves 4096 interior points plus its two implicit endpoints', () => {
	const duration = 4_097;
	const points = Array.from({ length: 4_096 }, (_, index) => ({
		frame: index + 1,
		value: (index % 16) / 16,
	}));
	const expected = createEnvelopeValueEvaluator(points, duration);
	const curve = compileEnvelopeInterpolationCurve(points, duration);
	assert.equal(curve.anchors.length, 4_098);
	assert.equal(curve.segments.length, 4_097);
	for (const frame of [0, 1, 2_047, 4_095, 4_096, 4_097]) {
		assert.equal(evaluateInterpolationCurve(curve, frame), expected(frame));
	}
});

test('legacy envelope adapter retains finite interpolation operation ordering exactly', () => {
	const seed = [{ frame: 0, value: 0.00012522190815080977 }, {
		frame: 4, value: 4.440201567690913,
	}];
	const curve = compileEnvelopeInterpolationCurve(seed, 4);
	const legacy = createEnvelopeValueEvaluator(seed, 4);
	assert.equal(evaluateInterpolationCurve(curve, 2), legacy(2));

	let state = 0x75_21_88_43;
	const random = () => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state / 0x1_00_00_00_00;
	};
	for (let fixture = 0; fixture < 256; fixture += 1) {
		const points = [{ frame: 0, value: random() * 16 }, { frame: 4, value: random() * 16 }];
		const generated = compileEnvelopeInterpolationCurve(points, 4);
		const expected = createEnvelopeValueEvaluator(points, 4);
		for (const frame of [1, 2, 3]) {
			assert.equal(evaluateInterpolationCurve(generated, frame), expected(frame));
		}
	}
});

test('audio-warp and video-breakpoint maps retain exact linear/freeze behavior through the adapter', () => {
	const maps = [{
		feature: 'audio-warp' as const,
		points: [
			{ outer: rational(0), source: rational(2), mode: 'forward' as const },
			{ outer: rational(3), source: rational(8), mode: 'forward' as const },
			{ outer: rational(7), source: rational(10), mode: 'forward' as const },
		],
	}, {
		feature: 'video-retime' as const,
		points: [
			{ outer: rational(0), source: rational(2), mode: 'forward' as const },
			{ outer: rational(2), source: rational(6), mode: 'freeze' as const },
			{ outer: rational(4), source: rational(6), mode: 'reverse' as const },
			{ outer: rational(8), source: rational(2), mode: 'forward' as const },
		],
	}];
	for (const map of maps) {
		const curve = compileBreakpointInterpolationCurve(map);
		for (const outer of [rational(-1), rational(0), rational(1), rational(5, 2), rational(4), rational(7), rational(9)]) {
			const expected = evaluateBreakpointMap(map, outer);
			assert.ok(Math.abs(
				evaluateInterpolationCurve(curve, outer) - expected.num / expected.den,
			) <= Number.EPSILON * 8);
		}
	}
});

test('breakpoint piece adapter preserves signed and maximum-denominator maps', () => {
	const maximum = Number.MAX_SAFE_INTEGER;
	const maps = [{
		feature: 'video-retime' as const,
		points: [
			{ outer: rational(-7, 3), source: rational(-5, 7), mode: 'forward' as const },
			{ outer: rational(-1, 3), source: rational(9, 7), mode: 'freeze' as const },
			{ outer: rational(5, 3), source: rational(9, 7), mode: 'reverse' as const },
			{ outer: rational(8, 3), source: rational(-2, 7), mode: 'forward' as const },
		],
	}, {
		feature: 'audio-warp' as const,
		points: [
			{ outer: rational(0), source: rational(0), mode: 'forward' as const },
			{ outer: rational(1, maximum), source: rational(1, maximum), mode: 'forward' as const },
			{ outer: rational(1, 1_000_001), source: rational(1, 1_000_001), mode: 'forward' as const },
			{ outer: rational(1), source: rational(1), mode: 'forward' as const },
		],
	}];
	const queries = [[rational(-3), rational(-7, 3), rational(-4, 3), rational(-1, 3),
		rational(2, 3), rational(5, 3), rational(2), rational(3)], [
		rational(0), rational(1, maximum),
		rational(1, 2_000_002), rational(1, 1_000_001), rational(1),
	]];
	for (const [index, map] of maps.entries()) {
		assert.throws(() => compileBreakpointInterpolationCurve(map), /non-negative|denominator|rational/iu,
			'the absolute single-curve convenience retains truthful core-domain limits');
		const before = structuredClone(map);
		const adapter = compileBreakpointInterpolationAdapter(map);
		assert.deepEqual(map, before);
		assert.equal(adapter.pieces.length, map.points.length - 1);
		assert.doesNotThrow(() => JSON.stringify(adapter));
		for (const query of queries[index] ?? []) {
			const expected = evaluateBreakpointMap(map, query);
			const actual = evaluateBreakpointInterpolationAdapter(adapter, query);
			const expectedNumber = expected.num / expected.den;
			assert.equal(actual, expectedNumber,
				`${String(query.num)}/${String(query.den)} preserves the exact observable Number`);
		}
	}
});

test('breakpoint piece adapter preserves generated exact evaluator Number results', () => {
	let state = 0x31_05_a7_19;
	const randomInteger = (maximum: number) => {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		return state % maximum;
	};
	for (let fixture = 0; fixture < 256; fixture += 1) {
		const outerStart = randomInteger(41) - 20;
		const outerMiddle = outerStart + 1 + randomInteger(20);
		const outerEnd = outerMiddle + 1 + randomInteger(20);
		const sourceStart = randomInteger(41) - 20;
		const sourceMiddle = sourceStart + 1 + randomInteger(20);
		const sourceEnd = sourceMiddle + 1 + randomInteger(20);
		const map = {
			feature: 'audio-warp' as const,
			points: [
				{ outer: rational(outerStart, 7), source: rational(sourceStart, 11), mode: 'forward' as const },
				{ outer: rational(outerMiddle, 7), source: rational(sourceMiddle, 11), mode: 'forward' as const },
				{ outer: rational(outerEnd, 7), source: rational(sourceEnd, 11), mode: 'forward' as const },
			],
		};
		const adapter = compileBreakpointInterpolationAdapter(map);
		for (let queryIndex = 0; queryIndex < 32; queryIndex += 1) {
			const query = rational(outerStart * 13 + randomInteger((outerEnd - outerStart) * 13 + 1), 91);
			const expected = evaluateBreakpointMap(map, query);
			assert.equal(evaluateBreakpointInterpolationAdapter(adapter, query), expected.num / expected.den);
		}
	}
});

test('V2 retime constants, freeze, reverse, and exact ramps map to vocabulary segments', () => {
	const input = {
		version: 2 as const,
		outerFrameCount: 12,
		sourceStartFrame: 0,
		sourceFrameCount: 20,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0) },
			{ outerFrame: 2, sourceFrame: rational(2) },
			{ outerFrame: 4, sourceFrame: rational(2) },
			{ outerFrame: 8, sourceFrame: rational(10) },
			{ outerFrame: 12, sourceFrame: rational(2) },
		],
		segments: [
			{ mode: 'constant-forward' as const },
			{ mode: 'freeze' as const },
			{ mode: 'ramp-forward' as const, startVelocity: rational(4), endVelocity: rational(0) },
			{ mode: 'ramp-reverse' as const, startVelocity: rational(0), endVelocity: rational(4) },
		],
	};
	const before = structuredClone(input);
	const retime = compileVideoRetimeCurve(input);
	const curve = compileVideoRetimeInterpolationCurve(input);
	for (let numerator = -2; numerator <= 26; numerator += 1) {
		const query = numerator % 2 === 0 ? rational(numerator / 2) : rational(numerator, 2);
		const clampedNumerator = Math.max(0, Math.min(24, numerator));
		const expectedQuery = clampedNumerator % 2 === 0
			? rational(clampedNumerator / 2) : rational(clampedNumerator, 2);
		const expected = evaluateVideoRetimeCurve(retime, expectedQuery);
		assert.ok(Math.abs(
			evaluateInterpolationCurve(curve, query)
				- Number(expected.numerator) / Number(expected.denominator),
		) <= 1e-11, `outer ${String(numerator)}/2`);
	}
	assert.deepEqual(input, before, 'the adapter must not rewrite the existing wire');
});

test('V2 maximum-safe ramps use exact integer origins and bounded local Rational handles', () => {
	const maximum = Number.MAX_SAFE_INTEGER;
	const input = {
		version: 2 as const,
		outerFrameCount: maximum,
		sourceStartFrame: 0,
		sourceFrameCount: 1,
		points: [
			{ outerFrame: 0, sourceFrame: rational(0) },
			{ outerFrame: maximum, sourceFrame: rational(1) },
		],
		segments: [{
			mode: 'ramp-forward' as const,
			startVelocity: rational(0),
			endVelocity: rational(2, maximum),
		}],
	};
	const retime = compileVideoRetimeCurve(input);
	assert.throws(() => compileVideoRetimeInterpolationCurve(input), /absolute|handle|rational domain/iu,
		'a single absolute curve reports its truthful Rational handle limit');
	const adapter = compileVideoRetimeInterpolationAdapter(input);
	assert.equal(adapter.pieces.length, 2);
	assert.deepEqual(adapter.pieces.map((piece) => piece.origin), [rational(0), rational(maximum - 1)]);
	for (const piece of adapter.pieces) {
		assert.equal(piece.curve.segments[0]?.kind, 'bezier');
		assert.doesNotThrow(() => JSON.stringify(piece), 'piece metadata and local curves remain JSON-compatible');
	}
	for (const outer of [rational(0), rational(1, 2), rational(1), rational(1_000_001, 2),
		rational(Math.floor(maximum / 2)), rational(maximum - 1), rational(maximum)]) {
		const expected = evaluateVideoRetimeCurve(retime, outer);
		const actual = evaluateVideoRetimeInterpolationAdapter(adapter, outer);
		assert.ok(Math.abs(actual - Number(expected.numerator) / Number(expected.denominator)) <= 1e-15);
	}
});
