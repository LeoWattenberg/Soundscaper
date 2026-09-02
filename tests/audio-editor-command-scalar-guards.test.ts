/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
	nonNegativeSafeInteger,
	positiveSafeInteger,
	safeInteger,
} from '../src/common/editor/commands/scalar-guards.ts';

test('command scalar guards refuse negative zero on non-negative and positive contracts', () => {
	// Nine command modules used to carry their own copy of these guards, and
	// three of them rejected -0 while the rest returned it. A frame index of -0
	// is not the 0 a caller comparing with Object.is expects, so every module
	// now refuses it at the same boundary rather than by accident of which one
	// parsed the payload first.
	assert.throws(
		() => nonNegativeSafeInteger(-0, 'startFrame'),
		/^RangeError: startFrame must be a non-negative safe integer\.$/u,
	);
	assert.throws(
		() => positiveSafeInteger(-0, 'durationFrames'),
		/^RangeError: durationFrames must be a positive safe integer\.$/u,
	);
	// The signed guard has no range to violate, so it normalizes instead.
	assert.ok(Object.is(safeInteger(-0, 'delta'), 0));
});

test('command scalar guards accept their range and reject everything outside it', () => {
	assert.equal(nonNegativeSafeInteger(0, 'startFrame'), 0);
	assert.equal(nonNegativeSafeInteger(48_000, 'startFrame'), 48_000);
	assert.equal(positiveSafeInteger(1, 'durationFrames'), 1);
	assert.equal(safeInteger(-5, 'delta'), -5);

	for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined, 2 ** 53]) {
		assert.throws(() => nonNegativeSafeInteger(value, 'startFrame'), RangeError, `nonNegative ${String(value)}`);
	}
	for (const value of [0, -1, 1.5, Number.NaN, '3', null, undefined]) {
		assert.throws(() => positiveSafeInteger(value, 'durationFrames'), RangeError, `positive ${String(value)}`);
	}
	for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined]) {
		assert.throws(() => safeInteger(value, 'delta'), RangeError, `safe ${String(value)}`);
	}
});
