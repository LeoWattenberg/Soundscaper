/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalKeyValueComparison } from '../src/common/editor/storage/key-value-canonical-comparison.ts';

test('key/value comparison follows JSON omission and array-null semantics', () => {
	assert.equal(
		canonicalKeyValueComparison({ retained: 1, omitted: undefined }),
		canonicalKeyValueComparison({ retained: 1 }),
	);
	assert.equal(
		canonicalKeyValueComparison([undefined, () => undefined, Symbol('omitted')]),
		canonicalKeyValueComparison([null, null, null]),
	);
	assert.equal(
		canonicalKeyValueComparison(Number.NaN),
		canonicalKeyValueComparison(Number.POSITIVE_INFINITY),
	);
	assert.notEqual(canonicalKeyValueComparison(Number.NaN), canonicalKeyValueComparison(null));
});

test('key/value comparison authenticates binary representation and ordering', () => {
	assert.equal(
		canonicalKeyValueComparison({ bytes: Uint8Array.of(1, 2, 3) }),
		canonicalKeyValueComparison({ bytes: Uint8Array.of(1, 2, 3) }),
	);
	assert.notEqual(
		canonicalKeyValueComparison({ bytes: Uint8Array.of(1, 2, 3) }),
		canonicalKeyValueComparison({ bytes: Uint16Array.of(513, 3) }),
	);
	assert.notEqual(
		canonicalKeyValueComparison({ first: 1, second: 2 }),
		canonicalKeyValueComparison({ second: 2, first: 1 }),
	);
});

test('key/value comparison refuses non-JSON and cyclic data', () => {
	assert.throws(() => canonicalKeyValueComparison(1n), /requires canonical JSON data/u);
	const cyclic: { self?: unknown } = {};
	cyclic.self = cyclic;
	assert.throws(() => canonicalKeyValueComparison(cyclic), /cannot be cyclic/u);
});
