/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { exactVideoMidpointSeconds } from '../src/common/editor/video-exact-time-midpoint.ts';

test('exact source-frame midpoint is formed by cross multiplication before Number conversion', () => {
	assert.equal(exactVideoMidpointSeconds(
		{ numerator: 1n, denominator: 3n },
		{ numerator: 2n, denominator: 3n },
		'frame midpoint invalid',
	), 0.5);
	assert.equal(exactVideoMidpointSeconds(
		{ numerator: 0n, denominator: 1n },
		{ numerator: 1n, denominator: 3n },
		'frame midpoint invalid',
	), 1 / 6);
});

test('exact source-frame midpoint preserves the caller refusal for invalid browser timestamps', () => {
	for (const [start, end] of [
		[{ numerator: -2n, denominator: 1n }, { numerator: -1n, denominator: 1n }],
		[{ numerator: 10n ** 500n, denominator: 1n }, { numerator: 10n ** 500n, denominator: 1n }],
	] as const) {
		assert.throws(() => exactVideoMidpointSeconds(start, end,
			'The caller owns an unsupported presentation timestamp.'), {
			name: 'RangeError', message: 'The caller owns an unsupported presentation timestamp.',
		});
	}
});
