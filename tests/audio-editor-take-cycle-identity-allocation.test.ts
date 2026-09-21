/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTakeCyclePassIdentityAllocator,
	registerFreshTakeCycleIdentity,
} from '../src/common/editor/controller/recording/internal/take-cycle/take-cycle-identity-allocation.ts';

test('take-cycle pass identity allocation reuses only the registered first lane', () => {
	const identities = new Set<string>();
	registerFreshTakeCycleIdentity('lane-first', 'lane', identities);
	const counters = new Map<string, number>();
	const allocate = createTakeCyclePassIdentityAllocator((kind) => {
		const next = (counters.get(kind) ?? 0) + 1;
		counters.set(kind, next);
		return `${kind}-${String(next)}`;
	}, identities);

	assert.deepEqual(allocate(0, 'lane-first'), {
		laneId: 'lane-first', takeId: 'take-1', mediaId: 'media-1', journalId: 'journal-1',
	});
	assert.deepEqual(allocate(1, 'lane-first'), {
		laneId: 'lane-1', takeId: 'take-2', mediaId: 'media-2', journalId: 'journal-2',
	});
	assert.deepEqual(counters, new Map([
		['take', 2], ['media', 2], ['journal', 2], ['lane', 1],
	]));
});

test('take-cycle identity allocation rejects reused and noncanonical generated IDs', () => {
	const identities = new Set(['already-owned']);
	assert.throws(
		() => registerFreshTakeCycleIdentity('already-owned', 'media', identities),
		/Take cycle media ID already-owned is not globally fresh/u,
	);
	assert.throws(
		() => registerFreshTakeCycleIdentity('x'.repeat(257), 'media', identities),
		/invalid/u,
	);
	const allocate = createTakeCyclePassIdentityAllocator(() => 'duplicate', identities);
	assert.throws(() => allocate(0, 'lane-first'), /not globally fresh/u);
});
