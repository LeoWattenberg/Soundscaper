/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSourceFrameRate } from '../src/common/editor/sequence-timecode.ts';

test('source views share one positive rational frame-rate admission', () => {
	const rate = normalizeSourceFrameRate({ num: '30000', den: 1_001 });
	assert.deepEqual(rate, { num: 30_000, den: 1_001 });
	assert.equal(Object.isFrozen(rate), true);
	for (const value of [null, [], {}, { num: 0, den: 1 }, { num: 24, den: 0 }, { num: 1.5, den: 1 }]) {
		assert.throws(() => normalizeSourceFrameRate(value), /source frame rate/u);
	}
});
