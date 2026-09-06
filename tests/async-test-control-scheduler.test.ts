/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The suites wait on `settle` and `waitFor` rather than on a hand-rolled poll,
 * so the scheduler they are built from is held to its own contract here: every
 * queue is visited in one turn, a wait that is already satisfied costs nothing,
 * and a wait that runs out of turns says what it never saw.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { settle, waitFor, waitForEvent } from './helpers/async-test-control.ts';

test('one turn drains the microtask, immediate and timer queues, microtasks first', async () => {
	const order: string[] = [];
	void Promise.resolve().then(() => { order.push('microtask'); });
	setImmediate(() => { order.push('immediate'); });
	setTimeout(() => { order.push('timer'); }, 0);

	await settle();

	assert.equal(order[0], 'microtask', 'microtasks drain before either macrotask queue');
	assert.deepEqual([...order].sort(), ['immediate', 'microtask', 'timer']);
});

test('each turn advances work that reschedules itself one hop at a time', async () => {
	let hops = 0;
	const hop = (): void => { if (++hops < 3) setImmediate(hop); };
	setImmediate(hop);
	await settle(3);
	assert.equal(hops, 3, 'each turn advances one immediate hop');
});

test('settle rejects a turn count that is not a whole number of turns', async () => {
	await assert.rejects(settle(-1), RangeError);
	await assert.rejects(settle(1.5), RangeError);
	await settle(0);
});

test('a wait that already holds returns without spending a turn', async () => {
	let advanced = false;
	setImmediate(() => { advanced = true; });
	let evaluations = 0;

	await waitFor(() => { evaluations += 1; return true; }, 'the satisfied condition');

	assert.equal(evaluations, 1);
	assert.equal(advanced, false, 'a satisfied wait must not advance the loop behind the test');
});

for (const [queue, schedule] of [
	['microtask', (settled: () => void) => { void Promise.resolve().then(settled); }],
	['immediate', (settled: () => void) => { setImmediate(settled); }],
	['timer', (settled: () => void) => { setTimeout(settled, 1); }],
] as const) {
	test(`a wait is answered by work that lands on the ${queue} queue`, async () => {
		let held = false;
		schedule(() => { held = true; });
		await waitFor(() => held, `the ${queue} condition`);
		assert.equal(held, true);
	});
}

test('a wait accepts an asynchronous predicate', async () => {
	let ready = false;
	setTimeout(() => { ready = true; }, 1);
	await waitFor(async () => {
		await Promise.resolve();
		return ready;
	}, 'the awaited condition');
	assert.equal(ready, true);
});

test('a wait that runs out of turns names the condition and its bound', async () => {
	await assert.rejects(
		waitFor(() => false, 'the queued flush', { turns: 3 }),
		(error: unknown) => error instanceof assert.AssertionError
			&& error.message === 'Timed out after 3 turns waiting for the queued flush.',
	);
});

test('a wait spends every turn it is given before it fails', async () => {
	let evaluations = 0;
	await assert.rejects(waitFor(() => { evaluations += 1; return false; }, 'the never-ready condition', {
		turns: 4,
	}), /never-ready/u);
	assert.equal(evaluations, 5, 'the predicate is read once per turn and once after the last');
});

test('a wait rejects a turn bound below one turn', async () => {
	await assert.rejects(waitFor(() => true, 'the condition', { turns: 0 }), RangeError);
});

test('a delayed wait spends wall time on each turn rather than spinning', async () => {
	const started = process.hrtime.bigint();
	await assert.rejects(
		waitFor(() => false, 'the external condition', { turns: 2, delayMs: 5 }),
		/external condition/u,
	);
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
	assert.ok(elapsedMs >= 5, `expected at least one 5ms turn, waited ${elapsedMs}ms`);
});

test('waitForEvent keeps its signature and reports the event it never saw', async () => {
	const events: string[] = [];
	setImmediate(() => { events.push('opened'); });
	await waitForEvent(events, 'opened');
	assert.deepEqual(events, ['opened']);

	await assert.rejects(waitForEvent(events, 'closed'), /waiting for event closed\./u);
});
