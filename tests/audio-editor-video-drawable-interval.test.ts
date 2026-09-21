/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { drawableVideoIntervalInteriorSeconds } from
	'../src/common/editor/video-drawable-interval.ts';
import { createExactVideoPresentationMapping } from
	'../src/common/editor/video-exact-presentation.ts';

const time = (numerator: bigint, denominator = 1n) => ({ numerator, denominator });

test('drawable interval chooses an interior browser seek and rejects invalid intervals', () => {
	assert.equal(drawableVideoIntervalInteriorSeconds({
		drawableSourceStartTime: time(9n), drawableSourceEndTime: time(10n),
	}), 9.5);
	for (const descriptor of [
		{},
		{ drawableSourceStartTime: time(9n), drawableSourceEndTime: time(9n) },
		{ drawableSourceStartTime: time(10n), drawableSourceEndTime: time(9n) },
		{ drawableSourceStartTime: time(9n, 0n), drawableSourceEndTime: time(10n) },
		{ drawableSourceStartTime: [], drawableSourceEndTime: time(10n) },
	]) assert.equal(drawableVideoIntervalInteriorSeconds(descriptor), null);
});

test('drawable interval uses its start when a finite endpoint midpoint overflows', () => {
	const start = BigInt(`1${'0'.repeat(308)}`);
	const end = BigInt(`11${'0'.repeat(307)}`);
	assert.equal(drawableVideoIntervalInteriorSeconds({
		drawableSourceStartTime: time(start), drawableSourceEndTime: time(end),
	}), 1e308);
});

test('preview retains its historical array-backed rational acceptance while exact mapping does not', () => {
	const start = Object.assign([], time(1n));
	const descriptor = { drawableSourceStartTime: start, drawableSourceEndTime: time(2n) };
	assert.equal(drawableVideoIntervalInteriorSeconds(descriptor), null);
	assert.equal(drawableVideoIntervalInteriorSeconds(descriptor, { allowArrayRationals: true }), 1.5);
});

test('exact presentation falls back to source time when the optional drawable interval is invalid', () => {
	const mapping = createExactVideoPresentationMapping({
		sourceFrame: time(4n), sourceTime: time(9n, 2n),
		drawableSourceStartTime: time(10n), drawableSourceEndTime: time(9n),
	}, 5, 48_000);
	assert.equal(mapping.sourceTimeSeconds, 4.5);
});
