/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CapturedVideoProxyAutomaticReconciliation,
	CapturedVideoProxyBoundedState,
	capturedVideoProxySchedulerPolicy,
} from '../src/framescaper/editor-captured-video-proxy-scheduler-state.ts';

function settle(): Promise<void> {
	return new Promise((resolve) => { setTimeout(resolve, 5); });
}

test('an empty scheduler policy resolves to its documented defaults', () => {
	assert.deepEqual(capturedVideoProxySchedulerPolicy({}), {
		maximumLineageEntries: 64,
		maximumLandedEntries: 16,
		maximumReconciliationAttempts: 3,
	});
});

test('scheduler policy overrides are admitted inside their bounds', () => {
	assert.deepEqual(capturedVideoProxySchedulerPolicy({
		maximumLineageEntries: 8,
		maximumLandedEntries: 2,
		maximumReconciliationAttempts: 5,
	}), {
		maximumLineageEntries: 8,
		maximumLandedEntries: 2,
		maximumReconciliationAttempts: 5,
	});
});

test('a scheduler policy value outside its closed range is refused', () => {
	for (const value of [
		{ maximumLineageEntries: 0 },
		{ maximumLineageEntries: 257 },
		{ maximumLandedEntries: 0 },
		{ maximumLandedEntries: 65 },
		{ maximumReconciliationAttempts: 0 },
		{ maximumReconciliationAttempts: 9 },
		{ maximumLandedEntries: 1.5 },
	]) {
		assert.throws(() => capturedVideoProxySchedulerPolicy(value), RangeError);
	}
});

test('a strict bounded state refuses a new key once its capacity is occupied', () => {
	const state = new CapturedVideoProxyBoundedState<number>(2);
	state.set('a', 1);
	state.set('b', 2);

	assert.throws(() => state.set('c', 3), /capacity is occupied/u);
	assert.throws(() => state.assertCapacity('c'), /capacity is occupied/u);
	assert.equal(state.get('a'), 1);
	assert.equal(state.get('b'), 2);
	assert.equal(state.get('c'), null);
});

test('a strict bounded state still updates a key it already holds at capacity', () => {
	const state = new CapturedVideoProxyBoundedState<number>(2);
	state.set('a', 1);
	state.set('b', 2);

	assert.doesNotThrow(() => state.assertCapacity('a'));
	state.set('a', 10);

	assert.equal(state.get('a'), 10);
	assert.equal(state.get('b'), 2);
});

test('releasing an entry frees the strict capacity it held', () => {
	const state = new CapturedVideoProxyBoundedState<number>(2);
	state.set('a', 1);
	state.set('b', 2);

	state.delete('b');
	state.set('c', 3);
	assert.equal(state.get('c'), 3);

	state.clear();
	state.set('d', 4);
	assert.equal(state.get('d'), 4);
	assert.equal(state.get('a'), null);
});

test('an evicting bounded state drops its oldest entry rather than refusing', () => {
	const state = new CapturedVideoProxyBoundedState<number>(2, true);
	state.set('a', 1);
	state.set('b', 2);
	state.set('c', 3);

	assert.equal(state.get('a'), null);
	assert.equal(state.get('b'), 2);
	assert.equal(state.get('c'), 3);
});

test('rewriting an entry refreshes its eviction recency', () => {
	const state = new CapturedVideoProxyBoundedState<number>(2, true);
	state.set('a', 1);
	state.set('b', 2);
	state.set('c', 3);

	state.set('b', 20);
	state.set('d', 4);

	assert.equal(state.get('b'), 20, 'the rewritten entry must outlive the one it overtook');
	assert.equal(state.get('c'), null);
	assert.equal(state.get('d'), 4);
});

test('automatic reconciliation retries up to its attempt bound and then reports exhaustion', async () => {
	const executed: string[] = [];
	const exhausted: string[] = [];
	const reconciliation = new CapturedVideoProxyAutomaticReconciliation<string>({
		maximumAttempts: 3,
		isPending: () => true,
		execute: async (request) => { executed.push(request); throw new Error('still failing'); },
		onExhausted: (key) => { exhausted.push(key); },
	});

	reconciliation.afterFailure('lineage', 'request');
	await settle();

	assert.equal(executed.length, 3);
	assert.deepEqual(exhausted, ['lineage']);
});

test('automatic reconciliation stops as soon as an attempt succeeds', async () => {
	let attempts = 0;
	const exhausted: string[] = [];
	const reconciliation = new CapturedVideoProxyAutomaticReconciliation<string>({
		maximumAttempts: 3,
		isPending: () => true,
		execute: async () => {
			attempts += 1;
			if (attempts < 2) throw new Error('first attempt fails');
		},
		onExhausted: (key) => { exhausted.push(key); },
	});

	reconciliation.afterFailure('lineage', 'request');
	await settle();

	assert.equal(attempts, 2);
	assert.deepEqual(exhausted, []);
});

test('automatic reconciliation never runs for work that is no longer pending', async () => {
	let attempts = 0;
	const reconciliation = new CapturedVideoProxyAutomaticReconciliation<string>({
		maximumAttempts: 3,
		isPending: () => false,
		execute: async () => { attempts += 1; },
		onExhausted: () => { assert.fail('settled work must not report exhaustion'); },
	});

	reconciliation.afterFailure('lineage', 'request');
	await settle();

	assert.equal(attempts, 0);
});

test('disposal cancels a queued reconciliation before it executes', async () => {
	let attempts = 0;
	const exhausted: string[] = [];
	const reconciliation = new CapturedVideoProxyAutomaticReconciliation<string>({
		maximumAttempts: 5,
		isPending: () => true,
		execute: async () => { attempts += 1; throw new Error('still failing'); },
		onExhausted: (key) => { exhausted.push(key); },
	});

	reconciliation.afterFailure('lineage', 'request');
	reconciliation.dispose();
	await settle();

	assert.equal(attempts, 0);
	assert.deepEqual(exhausted, []);
});

test('completing a key restores its full attempt budget', async () => {
	let attempts = 0;
	const exhausted: string[] = [];
	const reconciliation = new CapturedVideoProxyAutomaticReconciliation<string>({
		maximumAttempts: 2,
		isPending: () => true,
		execute: async () => { attempts += 1; throw new Error('still failing'); },
		onExhausted: (key) => { exhausted.push(key); },
	});

	reconciliation.afterFailure('lineage', 'request');
	await settle();
	assert.equal(attempts, 2);

	reconciliation.complete('lineage');
	reconciliation.afterFailure('lineage', 'request');
	await settle();

	assert.equal(attempts, 4);
	assert.deepEqual(exhausted, ['lineage', 'lineage']);
});
