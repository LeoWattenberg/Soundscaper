/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { addArchiveSafeIntegers } from '../src/common/editor/controller/export/archive-safe-integer-addition.ts';

test('archive addition preserves zero and the largest exact sum', () => {
	assert.equal(addArchiveSafeIntegers(), 0);
	assert.equal(addArchiveSafeIntegers(0, 2, 3), 5);
	assert.equal(addArchiveSafeIntegers(Number.MAX_SAFE_INTEGER - 1, 1), Number.MAX_SAFE_INTEGER);
});

test('archive addition refuses invalid operands and cumulative overflow with the existing diagnostic', () => {
	for (const values of [[-1], [0.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1], [Number.MAX_SAFE_INTEGER, 1]]) {
		assert.throws(() => addArchiveSafeIntegers(...values), {
			name: 'RangeError', message: "Archive size exceeds JavaScript's safe-integer range.",
		});
	}
});
