/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { approximatePositiveRational } from '../src/common/editor/rational-approximation.ts';

test('external floating values recover their nearest bounded canonical rationals', () => {
	assert.deepEqual(approximatePositiveRational(33.333333333333336), { num: 100, den: 3 });
	assert.deepEqual(approximatePositiveRational(0.1), { num: 1, den: 10 });
	assert.deepEqual(approximatePositiveRational(Math.PI, 8), { num: 22, den: 7 });
	assert.deepEqual(approximatePositiveRational(120), { num: 120, den: 1 });
	assert.throws(() => approximatePositiveRational(0), /positive/iu);
	assert.throws(() => approximatePositiveRational(120, 0), /maximumDenominator/iu);
});

test('a value too small for the denominator bound still recovers a positive rational', () => {
	// Rounding to the nearest bounded rational reaches zero once the value falls
	// below half of 1/maximumDenominator. Zero is not a rational this function may
	// hand back: callers divide by it, and the nearest bounded positive rational is
	// always the smallest one the bound can express.
	assert.deepEqual(approximatePositiveRational(0.04, 2), { num: 1, den: 2 });
	assert.deepEqual(approximatePositiveRational(1e-9, 4), { num: 1, den: 4 });
	assert.deepEqual(approximatePositiveRational(Number.MIN_VALUE), { num: 1, den: 1_000_000 });
	for (const denominator of [1, 2, 3, 7, 128, 1_000]) {
		const recovered = approximatePositiveRational(Number.EPSILON, denominator);
		assert.ok(recovered.num > 0, `bound ${denominator} recovered ${recovered.num}/${recovered.den}`);
	}
});
