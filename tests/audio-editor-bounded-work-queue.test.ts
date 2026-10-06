/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoundedWorkQueue } from '../src/common/editor/controller/source/internal/bounded-work-queue.ts';

void test('bounded work queues prioritize visible jobs and remove cancelled pending work', async () => {
	const queue = createBoundedWorkQueue(1, 3);
	const order: string[] = [];
	let release: (() => void) | undefined;
	const first = queue.run(async () => { order.push('first'); await new Promise<void>(resolve => { release = resolve; }); });
	const abort = new AbortController();
	const cancelled = queue.run(async () => { order.push('cancelled'); }, { signal: abort.signal });
	const cancelledCheck = assert.rejects(cancelled);
	const overscan = queue.run(async () => { order.push('overscan'); }, { priority: 1 });
	const visible = queue.run(async () => { order.push('visible'); }, { priority: 0 });
	assert.deepEqual(queue.snapshot(), { active: 1, pending: 3 });
	await assert.rejects(queue.run(async () => undefined), /full/u);
	abort.abort();
	await cancelledCheck;
	await Promise.resolve(); release?.();
	await Promise.all([first, overscan, visible]);
	await Promise.resolve();
	assert.deepEqual(order, ['first', 'visible', 'overscan']);
	assert.deepEqual(queue.snapshot(), { active: 0, pending: 0 });
});

void test('aborted admission does not start work between scheduling and its first microtask', async () => {
	const queue = createBoundedWorkQueue(1, 1);
	const abort = new AbortController();
	let calls = 0;
	const pending = queue.run(async () => { calls += 1; }, { signal: abort.signal });
	abort.abort();
	await assert.rejects(pending);
	assert.equal(calls, 0);
});
