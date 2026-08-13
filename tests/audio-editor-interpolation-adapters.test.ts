/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEnvelopeValueEvaluator } from '../src/common/editor/automation.js';
import {
	compileBreakpointInterpolationCurve,
	compileEnvelopeInterpolationCurve,
	compileVideoRetimeInterpolationCurve,
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
