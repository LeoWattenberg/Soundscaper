/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateScapeErrors } from '../src/common/editor/scape-abort.ts';

test('known cancellation classification preserves opaque primary and cleanup without inspecting the reason', () => {
	let traps = 0;
	const primary = new Proxy({}, { get() { traps += 1; throw new Error('Opaque reason accessed'); },
		getPrototypeOf() { traps += 1; throw new Error('Opaque reason prototype accessed'); } });
	const cleanup = new Error('Extraction cleanup failed');
	for (const primaryIsAbort of [true, false]) {
		const result = aggregateScapeErrors(primary, [cleanup], 'Extraction failed', { primaryIsAbort });
		assert.ok(result instanceof AggregateError); assert.equal(result.errors[0], primary); assert.equal(result.errors[1], cleanup);
		assert.equal(result.name, primaryIsAbort ? 'AbortError' : 'AggregateError');
	}
	assert.equal(traps, 0);
});

test('legacy Error cancellation names and empty cleanup retain their existing behavior', () => {
	const primary = new Error('Cancelled'); primary.name = 'AbortError';
	assert.equal(aggregateScapeErrors(primary, [], 'Cancelled'), primary);
	const result = aggregateScapeErrors(primary, [new Error('Cleanup')], 'Cancelled');
	assert.ok(result instanceof AggregateError); assert.equal(result.name, 'AbortError'); assert.equal(result.errors[0], primary);
	const failure = new Error('Decode failed'), aggregate = aggregateScapeErrors(failure, [new Error('Cleanup')], 'Failed');
	assert.ok(aggregate instanceof AggregateError); assert.equal(aggregate.name, 'AggregateError');
});
