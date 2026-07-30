/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PendingProjectQueue,
	createPendingProjectDelivery,
	redispatchPendingProjectsAfterReadRelease,
} from '../desktop/file-associations.js';
import { ReadCapabilityStore } from '../desktop/file-capabilities.js';
import {
	ReadCapabilityAdmissionError,
	ScapeRangeReadAdmission,
	isRetryableReadCapabilityAdmissionError,
} from '../desktop/read-capability-admission.js';
import { registerSelectedReadCapability } from '../desktop/read-selection-service.js';

const OWNER = Object.freeze({ name: 'renderer-owner' });

test('Scape admission marks temporary pressure retryable but not an intrinsically oversized project', () => {
	const countAdmission = new ScapeRangeReadAdmission({ maximumCount: 1, maximumBytes: 10 });
	const countTicket = countAdmission.reserve(OWNER);
	assert.throws(
		() => countAdmission.reserve(Object.freeze({ name: 'other-owner' })),
		(error) => error instanceof RangeError && isRetryableReadCapabilityAdmissionError(error),
	);
	countAdmission.release(countTicket);

	const aggregateAdmission = new ScapeRangeReadAdmission({ maximumCount: 2, maximumBytes: 10 });
	const firstTicket = aggregateAdmission.reserve(OWNER);
	aggregateAdmission.charge(firstTicket, 6);
	const secondTicket = aggregateAdmission.reserve(OWNER);
	assert.throws(
		() => aggregateAdmission.charge(secondTicket, 5),
		(error) => error instanceof RangeError && isRetryableReadCapabilityAdmissionError(error),
	);
	aggregateAdmission.release(secondTicket);
	aggregateAdmission.release(firstTicket);

	const oversizeTicket = aggregateAdmission.reserve(OWNER);
	assert.throws(
		() => aggregateAdmission.charge(oversizeTicket, 11),
		(error) => error instanceof RangeError && !isRetryableReadCapabilityAdmissionError(error),
	);
	aggregateAdmission.release(oversizeTicket);
});

test('a released read capability redispatches a project held behind transient admission pressure', async () => {
	const delivered = Promise.withResolvers();
	const attempts = [];
	let capacityAvailable = false;
	const delivery = createPendingProjectDelivery({
		isReady: () => true,
		currentOwner: () => OWNER,
		isOwnerCurrent: (owner) => owner === OWNER,
		register: async (filePath) => {
			attempts.push(filePath);
			if (!capacityAvailable) {
				throw new ReadCapabilityAdmissionError('Scape range capability count exceeds the limit', {
					retryable: true,
				});
			}
			return { id: 'read-id', name: 'queued.scape' };
		},
		release: async () => true,
		send: (descriptor) => {
			delivered.resolve(descriptor);
			return true;
		},
		reportError: assert.fail,
	});
	const queue = new PendingProjectQueue(delivery);
	queue.enqueue('/projects/queued.scape');

	await queue.dispatch();
	assert.deepEqual(attempts, ['/projects/queued.scape']);

	capacityAvailable = true;
	assert.equal(await redispatchPendingProjectsAfterReadRelease(queue, Promise.resolve(true)), true);
	assert.deepEqual(await delivered.promise, { id: 'read-id', name: 'queued.scape' });
	assert.deepEqual(attempts, ['/projects/queued.scape', '/projects/queued.scape']);
});

test('five OS-open Scape paths backpressure on the real global count until one descriptor is released', async (context) => {
	const handles = [];
	const fifthDelivered = Promise.withResolvers();
	const store = new ReadCapabilityStore({
		openImpl: async (filePath, flags) => {
			assert.equal(flags, 'r');
			const handle = fakeHandle(filePath);
			handles.push(handle);
			return handle;
		},
	});
	context.after(async () => { await store.dispose().catch(() => undefined); });
	const sent = [];
	const delivery = createPendingProjectDelivery({
		isReady: () => true,
		currentOwner: () => OWNER,
		isOwnerCurrent: (owner) => owner === OWNER,
		register: (filePath, owner) => registerSelectedReadCapability(
			store,
			filePath,
			{ owner, purpose: 'project' },
		),
		release: (id, owner) => store.release(id, { owner }),
		send: (descriptor) => {
			sent.push(descriptor);
			if (sent.length === 5) fifthDelivered.resolve();
			return true;
		},
		reportError: assert.fail,
	});
	const queue = new PendingProjectQueue(delivery);
	for (let index = 1; index <= 5; index += 1) queue.enqueue(`/projects/${index}.scape`);

	await queue.dispatch();
	assert.equal(sent.length, 4);
	assert.equal(handles.length, 4, 'global count refusal happens before opening the fifth path');

	assert.equal(
		await redispatchPendingProjectsAfterReadRelease(
			queue,
			store.release(sent[0].id, { owner: OWNER }),
		),
		true,
	);
	await fifthDelivered.promise;
	await queue.dispatch();
	assert.equal(sent.length, 5);
	assert.equal(handles.length, 5);
	assert.equal(sent[4].name, '5.scape');

	await store.dispose();
	assert.equal(handles.every((handle) => handle.closeCalls === 1), true);
});

test('a failed renderer send releases its descriptor before reporting and removing the queue head', async () => {
	const events = [];
	const descriptor = { id: 'read-id', name: 'send-failure.scape' };
	const delivery = createPendingProjectDelivery({
		isReady: () => true,
		currentOwner: () => OWNER,
		isOwnerCurrent: (owner) => owner === OWNER,
		register: async () => descriptor,
		release: async (id, owner) => {
			events.push(['release', id, owner]);
			return true;
		},
		send: () => {
			events.push(['send']);
			throw new Error('renderer send failed');
		},
		reportError: (error) => events.push(['report', error.message]),
	});
	const queue = new PendingProjectQueue(delivery);
	queue.enqueue('/projects/send-failure.scape');

	await queue.dispatch();
	await queue.dispatch();

	assert.deepEqual(events, [
		['send'],
		['release', 'read-id', OWNER],
		['report', 'renderer send failed'],
	]);
});

test('a release that did not free capacity does not redispatch the retained queue head', async () => {
	let attempts = 0;
	const queue = new PendingProjectQueue(async () => {
		attempts += 1;
		return false;
	});
	queue.enqueue('/projects/blocked.scape');
	await queue.dispatch();

	assert.equal(await redispatchPendingProjectsAfterReadRelease(queue, Promise.resolve(false)), false);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(attempts, 1);
});

test('read release acknowledgement does not wait for redispatched project I/O', async () => {
	const deliveryStarted = Promise.withResolvers();
	const continueDelivery = Promise.withResolvers();
	const queue = new PendingProjectQueue(async () => {
		deliveryStarted.resolve();
		await continueDelivery.promise;
		return true;
	});
	queue.enqueue('/projects/stalled.scape');

	assert.equal(await redispatchPendingProjectsAfterReadRelease(queue, Promise.resolve(true)), true);
	await deliveryStarted.promise;
	const dispatchCompletion = queue.dispatch();
	assert.equal(await remainsPending(dispatchCompletion), true);

	continueDelivery.resolve();
	await dispatchCompletion;
});

async function remainsPending(promise) {
	const marker = Symbol('pending');
	return Promise.race([
		promise.then(() => false, () => false),
		new Promise((resolve) => setImmediate(resolve, marker)),
	]).then((result) => result === marker);
}

function fakeHandle(path) {
	return {
		closeCalls: 0,
		path,
		async stat() {
			return { isFile: () => true, size: 1, mtimeMs: 1 };
		},
		async close() {
			this.closeCalls += 1;
		},
	};
}
