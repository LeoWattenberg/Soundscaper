/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeliveryQueueRunner } from '../src/common/editor/controller/delivery-queue-runner.ts';

function abortError() {
	return Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

function job(jobId: string) {
	return {
		jobId,
		label: jobId,
		taskKind: 'encoded-export' as const,
		recoveryClass: 'atomic-restart' as const,
	};
}

function deferred() {
	let resolve: (value?: unknown) => void = () => undefined;
	let reject: (error: unknown) => void = () => undefined;
	const promise = new Promise((resolveFn, rejectFn) => {
		resolve = resolveFn as typeof resolve;
		reject = rejectFn;
	});
	return { promise, resolve, reject };
}

test('the runner drains jobs one at a time in order', async () => {
	const ran: string[] = [];
	const runner = createDeliveryQueueRunner({
		runJob: async (entry) => { ran.push(entry.jobId); },
	});
	runner.enqueue(job('a'));
	runner.enqueue(job('b'));
	await runner.settled();
	assert.deepEqual(ran, ['a', 'b']);
	assert.deepEqual(
		runner.getQueue().entries.map(({ jobId, state }) => [jobId, state]),
		[['a', 'completed'], ['b', 'completed']],
	);
});

test('a failing job is recorded as failed and does not stop the queue', async () => {
	const ran: string[] = [];
	const runner = createDeliveryQueueRunner({
		runJob: async (entry) => {
			ran.push(entry.jobId);
			if (entry.jobId === 'a') throw Object.assign(new Error('encoder died'), { name: 'EncoderFault' });
		},
	});
	runner.enqueue(job('a'));
	runner.enqueue(job('b'));
	await runner.settled();
	assert.deepEqual(ran, ['a', 'b'], 'one failure must not strand the rest of the queue');
	const [first, second] = runner.getQueue().entries;
	assert.equal(first.state, 'failed');
	assert.equal(first.lastFailureCode, 'EncoderFault');
	assert.equal(second.state, 'completed');
});

test('a job aborted mid-flight settles as cancelled rather than failed', async () => {
	const gate = deferred();
	const runner = createDeliveryQueueRunner({
		runJob: async (_entry, { signal }) => {
			signal.addEventListener('abort', () => gate.reject(abortError()));
			await gate.promise;
		},
	});
	runner.enqueue(job('a'));
	await Promise.resolve();
	runner.cancel('a');
	await runner.settled();
	assert.equal(runner.getQueue().entries[0].state, 'cancelled');
	assert.equal(
		runner.getQueue().entries[0].lastFailureCode,
		null,
		'a user cancelling is not a failure and records no failure code',
	);
});

test('cancelling a running job signals the executor', async () => {
	const gate = deferred();
	let sawAbort = false;
	const runner = createDeliveryQueueRunner({
		runJob: async (_entry, { signal }) => {
			signal.addEventListener('abort', () => { sawAbort = true; gate.resolve(); });
			await gate.promise;
		},
	});
	runner.enqueue(job('a'));
	await Promise.resolve();
	runner.cancel('a');
	await runner.settled();
	assert.equal(sawAbort, true, 'the executor must be told to stop, not merely marked stopped');
});

test('a completed executor cannot overwrite a cancellation the user already made', async () => {
	const gate = deferred();
	const runner = createDeliveryQueueRunner({
		runJob: async () => { await gate.promise; },
	});
	runner.enqueue(job('a'));
	await Promise.resolve();
	runner.cancel('a');
	gate.resolve();
	await runner.settled();
	assert.equal(
		runner.getQueue().entries[0].state,
		'cancelled',
		'a late success must not be reported as a delivery the user had already stopped',
	);
});

test('pause takes effect between jobs and resume continues the queue', async () => {
	const ran: string[] = [];
	const gate = deferred();
	const runner = createDeliveryQueueRunner({
		runJob: async (entry) => {
			ran.push(entry.jobId);
			if (entry.jobId === 'a') await gate.promise;
		},
	});
	runner.enqueue(job('a'));
	runner.enqueue(job('b'));
	await Promise.resolve();
	runner.pause();
	gate.resolve();
	await runner.settled();
	assert.deepEqual(ran, ['a'], 'the paused queue starts nothing after the running job finishes');
	assert.equal(runner.getQueue().entries[1].state, 'queued');

	runner.resume();
	await runner.settled();
	assert.deepEqual(ran, ['a', 'b']);
});

test('retry re-runs a failed job from the start as a new attempt', async () => {
	let attempts = 0;
	const runner = createDeliveryQueueRunner({
		runJob: async () => {
			attempts += 1;
			if (attempts === 1) throw new Error('transient');
		},
	});
	runner.enqueue(job('a'));
	await runner.settled();
	assert.equal(runner.getQueue().entries[0].state, 'failed');

	runner.retry('a');
	await runner.settled();
	assert.equal(runner.getQueue().entries[0].state, 'completed');
	assert.equal(runner.getQueue().entries[0].attempt, 2, 'a retry is a fresh attempt, never a resume');
	assert.equal(attempts, 2);
});

test('recovery after a kill returns the interrupted job whole', async () => {
	const gate = deferred();
	const runner = createDeliveryQueueRunner({ runJob: async () => { await gate.promise; } });
	runner.enqueue(job('a'));
	await Promise.resolve();
	assert.equal(runner.getQueue().entries[0].state, 'running');

	runner.recover();
	assert.equal(
		runner.getQueue().entries[0].state,
		'queued',
		'nothing durable exists, so the job restarts whole rather than resuming',
	);
	gate.resolve();
	await runner.settled();
});

test('every change is published so a view never has to poll', async () => {
	const states: string[][] = [];
	const runner = createDeliveryQueueRunner({
		runJob: async () => undefined,
		onChange: (queue) => { states.push(queue.entries.map(({ state }) => state)); },
	});
	runner.enqueue(job('a'));
	await runner.settled();
	assert.deepEqual(states, [['queued'], ['running'], ['completed']]);
});

test('a runner requires an executor rather than silently doing nothing', () => {
	assert.throws(
		() => createDeliveryQueueRunner({} as never),
		/requires a job executor/u,
	);
});
