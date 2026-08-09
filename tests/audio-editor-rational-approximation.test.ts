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
