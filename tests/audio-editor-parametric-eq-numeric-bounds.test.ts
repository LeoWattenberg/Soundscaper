/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveParametricEqNumericCommit } from '../src/common/editor/ui/parametric-eq-numeric-commit.ts';

test('EQ rejects frequencies outside its current bounds and restores the saved value', () => {
	for (const text of ['0', '9', '24001', '', ' ']) {
		assert.deepEqual(resolveParametricEqNumericCommit(text, '10', false, 10, 24000),
			{ commit: false, replacement: '10' });
	}
	for (const text of ['10', '1000.5', '24000']) {
		assert.deepEqual(resolveParametricEqNumericCommit(text, '10', false, 10, 24000),
			{ commit: true, value: Number(text) });
	}
});

test('EQ retains negative gain, fractional Q, and canceled drafts within their own ranges', () => {
	assert.deepEqual(resolveParametricEqNumericCommit('-6', '0', false, -30, 30), { commit: true, value: -6 });
	assert.deepEqual(resolveParametricEqNumericCommit('0.75', '1', false, 0.1, 30), { commit: true, value: 0.75 });
	assert.deepEqual(resolveParametricEqNumericCommit('0.75', '1', true, 0.1, 30), { commit: false, replacement: '1' });
});
