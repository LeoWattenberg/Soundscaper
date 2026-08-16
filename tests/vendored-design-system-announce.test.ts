/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTimeForA11y } from '../vendor/audacity-design-system/components/src/utils/announce.ts';

test('formatTimeForA11y spells the documented shapes out in words', () => {
	assert.equal(formatTimeForA11y(0), '0 seconds');
	assert.equal(formatTimeForA11y(0.5), '0.5 seconds');
	assert.equal(formatTimeForA11y(1), '1 second');
	assert.equal(formatTimeForA11y(65), '1 minute 5 seconds');
	assert.equal(formatTimeForA11y(3725), '1 hour 2 minutes 5 seconds');
});

test('formatTimeForA11y carries a rounded-up seconds remainder into minutes and hours', () => {
	assert.equal(formatTimeForA11y(59.94), '59.9 seconds');
	assert.equal(formatTimeForA11y(59.95), '1 minute');
	assert.equal(formatTimeForA11y(59.97), '1 minute');
	assert.equal(formatTimeForA11y(119.98), '2 minutes');
	assert.equal(formatTimeForA11y(3599.98), '1 hour');
	assert.equal(formatTimeForA11y(3659.99), '1 hour 1 minute');
	assert.equal(formatTimeForA11y(7199.99), '2 hours');
});

test('formatTimeForA11y never announces a sixty-second or sixty-minute remainder', () => {
	for (let tenths = 0; tenths <= 72000; tenths += 1) {
		const spoken = formatTimeForA11y(tenths / 10 + 0.06);
		assert.doesNotMatch(spoken, /\b60 (?:seconds|minutes)\b/u, `${tenths / 10 + 0.06} → ${spoken}`);
	}
});

test('formatTimeForA11y rejects non-finite and negative inputs', () => {
	assert.equal(formatTimeForA11y(Number.NaN), '0 seconds');
	assert.equal(formatTimeForA11y(Number.POSITIVE_INFINITY), '0 seconds');
	assert.equal(formatTimeForA11y(-1), '0 seconds');
});
