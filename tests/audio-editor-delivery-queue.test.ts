/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DeliveryQueueError,
	cancelDeliveryJob,
	completeDeliveryJob,
	createDeliveryQueue,
	enqueueDeliveryJob,
	failDeliveryJob,
	nextDeliveryJob,
	pauseDeliveryQueue,
	recoverDeliveryQueueAfterRestart,
	reorderDeliveryJob,
	resumeDeliveryQueue,
	retryDeliveryJob,
	startDeliveryJob,
} from '../src/common/editor/delivery-queue.ts';

function job(jobId: string, overrides: Record<string, unknown> = {}) {
	return {
		jobId,
		label: jobId,
		taskKind: 'encoded-export' as const,
		recoveryClass: 'atomic-restart' as const,
		...overrides,
	};
}

function queueOf(...ids: string[]) {
	return ids.reduce((queue, id) => enqueueDeliveryJob(queue, job(id)), createDeliveryQueue());
}

test('jobs run one at a time in FIFO order', () => {
	let queue = queueOf('a', 'b', 'c');
	assert.equal(nextDeliveryJob(queue)?.jobId, 'a');
	queue = startDeliveryJob(queue, 'a');
	assert.equal(nextDeliveryJob(queue), null, 'a running job blocks the next start');
	assert.throws(() => startDeliveryJob(queue, 'b'), /One delivery job runs at a time/u);
	queue = completeDeliveryJob(queue, 'a');
	assert.equal(nextDeliveryJob(queue)?.jobId, 'b');
});

test('a job that can neither restart atomically nor checkpoint stays out of the queue', () => {
	assert.throws(
		() => enqueueDeliveryJob(createDeliveryQueue(), job('x', { recoveryClass: 'best-effort' })),
		/declares no supported recovery class/u,
		'an invented recovery class must be refused rather than recorded',
	);
	assert.throws(
		() => enqueueDeliveryJob(createDeliveryQueue(), job('x', {
			taskKind: 'encoded-export',
			recoveryClass: 'verified-frame-checkpoint',
		})),
		/cannot checkpoint/u,
		'an encoded container has no verifiable partial state and may not claim resume',
	);
	const checkpointing = enqueueDeliveryJob(createDeliveryQueue(), job('seq', {
		taskKind: 'image-sequence-export',
		recoveryClass: 'verified-frame-checkpoint',
	}));
	assert.equal(checkpointing.entries[0].recoveryClass, 'verified-frame-checkpoint');
});

test('pause takes effect between jobs and never suspends a running one', () => {
	let queue = startDeliveryJob(queueOf('a', 'b'), 'a');
	queue = pauseDeliveryQueue(queue);
	assert.equal(queue.entries[0].state, 'running', 'pausing does not reach inside a running job');
	assert.equal(nextDeliveryJob(queue), null);
	queue = completeDeliveryJob(queue, 'a');
	assert.equal(nextDeliveryJob(queue), null, 'a paused queue starts nothing after the job finishes');
	assert.throws(() => startDeliveryJob(queue, 'b'), /paused delivery queue starts no jobs/u);
	queue = resumeDeliveryQueue(queue);
	assert.equal(nextDeliveryJob(queue)?.jobId, 'b');
});

test('retry re-queues a failed job and counts a fresh attempt', () => {
	let queue = startDeliveryJob(queueOf('a'), 'a');
	assert.equal(queue.entries[0].attempt, 1);
	queue = failDeliveryJob(queue, 'a', 'encoder-fault');
	assert.equal(queue.entries[0].state, 'failed');
	assert.equal(queue.entries[0].lastFailureCode, 'encoder-fault');
	queue = retryDeliveryJob(queue, 'a');
	assert.equal(queue.entries[0].state, 'queued');
	queue = startDeliveryJob(queue, 'a');
	assert.equal(queue.entries[0].attempt, 2, 'a retry is a new attempt, not a resumed one');
	assert.throws(() => retryDeliveryJob(completeDeliveryJob(queue, 'a'), 'a'), /nothing to retry/u);
});

test('cancellation is valid from queued and running and publishes nothing', () => {
	let queue = queueOf('a', 'b');
	queue = cancelDeliveryJob(queue, 'b');
	assert.equal(queue.entries[1].state, 'cancelled');
	queue = cancelDeliveryJob(startDeliveryJob(queue, 'a'), 'a');
	assert.equal(queue.entries[0].state, 'cancelled');
	assert.throws(() => cancelDeliveryJob(queue, 'a'), /already cancelled/u);
	assert.equal(nextDeliveryJob(queue), null, 'a fully cancelled queue has nothing to start');
	queue = retryDeliveryJob(queue, 'a');
	assert.equal(nextDeliveryJob(queue)?.jobId, 'a', 'a cancelled job can be retried from the start');
});

test('only unstarted jobs reorder, and reordering keeps every entry', () => {
	let queue = queueOf('a', 'b', 'c');
	queue = reorderDeliveryJob(queue, 'c', 0);
	assert.deepEqual(queue.entries.map(({ jobId }) => jobId), ['c', 'a', 'b']);
	assert.equal(nextDeliveryJob(queue)?.jobId, 'c');
	const running = startDeliveryJob(queue, 'c');
	assert.throws(() => reorderDeliveryJob(running, 'c', 2), /cannot be reordered/u);
	assert.throws(() => reorderDeliveryJob(queue, 'a', 9), /outside the delivery queue/u);
});

test('a kill mid-job leaves publishable state consistent by restarting that job whole', () => {
	let queue = queueOf('a', 'b');
	queue = failDeliveryJob(startDeliveryJob(queue, 'a'), 'a', 'crash');
	queue = retryDeliveryJob(queue, 'a');
	queue = startDeliveryJob(queue, 'a');

	const recovered = recoverDeliveryQueueAfterRestart(queue);
	assert.equal(recovered.entries[0].state, 'queued', 'an interrupted job returns whole, never half-done');
	assert.equal(recovered.entries[0].lastFailureCode, null);
	assert.equal(recovered.entries[1].state, 'queued');
	assert.equal(nextDeliveryJob(recovered)?.jobId, 'a');
});

test('recovery preserves terminal states and the paused flag', () => {
	let queue = queueOf('a', 'b', 'c');
	queue = completeDeliveryJob(startDeliveryJob(queue, 'a'), 'a');
	queue = cancelDeliveryJob(queue, 'c');
	queue = pauseDeliveryQueue(startDeliveryJob(queue, 'b'));

	const recovered = recoverDeliveryQueueAfterRestart(queue);
	assert.deepEqual(
		recovered.entries.map(({ jobId, state }) => [jobId, state]),
		[['a', 'completed'], ['b', 'queued'], ['c', 'cancelled']],
		'finished work stays finished; only the interrupted job returns to the queue',
	);
	assert.equal(recovered.paused, true, 'a queue paused before the kill is still paused after it');
});

test('queue records carry status and a plan reference, never media bytes', () => {
	const queue = startDeliveryJob(queueOf('a'), 'a');
	assert.deepEqual(Object.keys(queue.entries[0]).sort(), [
		'attempt', 'jobId', 'label', 'lastFailureCode', 'recoveryClass', 'state', 'taskKind',
	]);
	const serialized = JSON.stringify(queue);
	assert.ok(serialized.length < 512, 'a queue entry must stay a small record');
});

test('queues are frozen and transitions never mutate the previous value', () => {
	const queued = queueOf('a');
	const running = startDeliveryJob(queued, 'a');
	assert.equal(queued.entries[0].state, 'queued', 'the earlier queue value is untouched');
	assert.equal(running.entries[0].state, 'running');
	assert.ok(Object.isFrozen(running) && Object.isFrozen(running.entries));
	assert.throws(() => enqueueDeliveryJob(running, job('a')), /already queued/u);
	assert.throws(() => startDeliveryJob(running, 'missing'), DeliveryQueueError);
});
