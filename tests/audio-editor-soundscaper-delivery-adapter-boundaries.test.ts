/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SOUNDSCAPER_DELIVERY_PROGRESS_MESSAGE_TYPE,
	createSoundscaperPersistentDeliveryQueueAdapterV1,
	executeSoundscaperDeliveryRenderJobV1,
	type SoundscaperDeliveryRenderJobOptionsV1,
} from '../src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-adapter-v1.ts';
import { createBoundedPortMessage } from '../src/common/editor/platform/bounded-transfer.ts';
import type { PersistentRenderQueuePortV1 } from '../src/common/editor/platform/persistent-render-queue-port.ts';
import {
	SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE,
	type SoundscaperDeliveryDescriptionV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import {
	PROJECT, boundDestination, description, publicationFence, result, successfulHost, validateExactResult, writer,
} from './helpers/soundscaper-delivery-adapter-fixtures.ts';

const signal = new AbortController().signal;
const message = (type: string, payload: unknown) => createBoundedPortMessage(type, payload, {
	sequence: 0, maximumEncodedBytes: 4_096,
});

function queueOptions() {
	const queue: PersistentRenderQueuePortV1<SoundscaperDeliveryDescriptionV1, unknown, unknown> = {
		enqueue: async () => message('summary', { jobId: 'job-1' }),
		list: async () => message('list', []),
		events: async () => null,
		reorder: async () => undefined,
		pause: async () => undefined,
		resume: async () => undefined,
		cancel: async () => undefined,
		retry: async () => undefined,
	};
	return {
		queue, summaryMessageType: 'summary', listMessageType: 'list', eventMessageType: 'event',
		validateSummary: (value: unknown) => value, validateEvent: (value: unknown) => value,
	};
}

function renderOptions(order: string[] = []): SoundscaperDeliveryRenderJobOptionsV1<unknown> {
	const expected = description();
	return {
		description: expected, destination: boundDestination(writer(order)), signal,
		host: successfulHost(expected, order),
		currentAuthority: () => ({ projectIdentity: PROJECT, planFingerprint: expected.planFingerprint }),
		acquirePublicationFence: publicationFence(expected),
		validateExactResult,
	};
}

test('queue construction requires the complete port, validators and bounded message types', () => {
	const options = queueOptions();
	assert.throws(() => createSoundscaperPersistentDeliveryQueueAdapterV1({ ...options, queue: null } as never),
		/queue port is required/iu);
	assert.throws(() => createSoundscaperPersistentDeliveryQueueAdapterV1({
		...options, queue: { ...options.queue, retry: undefined },
	} as never), /requires retry/iu);
	assert.throws(() => createSoundscaperPersistentDeliveryQueueAdapterV1({
		...options, validateEvent: null,
	} as never), /validators are required/iu);
	for (const invalid of ['', ' summary', 'summary ', 's'.repeat(257), null]) {
		assert.throws(() => createSoundscaperPersistentDeliveryQueueAdapterV1({
			...options, summaryMessageType: invalid,
		} as never), /message type is required/iu);
	}
});

test('invalid pages and cursors are refused before exposing or validating queue entries', async () => {
	const options = queueOptions();
	let listCalls = 0;
	let validations = 0;
	const adapter = createSoundscaperPersistentDeliveryQueueAdapterV1({
		...options,
		queue: { ...options.queue, list: async () => { listCalls += 1; return message('list', [{}, {}]); } },
		validateSummary: (value) => { validations += 1; return value; },
	});
	for (const cursor of ['', ' cursor', 'cursor ', 'ä'.repeat(513)]) {
		await assert.rejects(adapter.list({ limit: 1, cursor, signal }), /bounded.*cursor/iu);
	}
	assert.equal(listCalls, 0);
	await assert.rejects(adapter.list({ limit: 1, signal }), /invalid page/iu);
	assert.equal(validations, 0);
	const notArray = createSoundscaperPersistentDeliveryQueueAdapterV1({
		...options,
		queue: { ...options.queue, list: async () => message('list', {}) as never },
	});
	await assert.rejects(notArray.list({ limit: 1, signal }), /invalid page/iu);
});

test('queue envelope admission rejects accessor fields, invalid bounds and misstated lengths', async () => {
	const options = queueOptions();
	const valid = message('summary', { jobId: 'job-1' });
	let accessorCalls = 0;
	const accessor = Object.defineProperty({ ...valid }, 'payload', {
		enumerable: true,
		get: () => { accessorCalls += 1; return valid.payload; },
	});
	const invalid: readonly [unknown, RegExp][] = [
		[null, /bounded port message/iu],
		[accessor, /own data property/iu],
		[{ ...valid, sequence: -1 }, /invalid message bounds/iu],
		[{ ...valid, encodedByteLength: 0 }, /invalid message bounds/iu],
		[{ ...valid, maximumEncodedBytes: 0 }, /invalid message bounds/iu],
		[{ ...valid, encodedByteLength: valid.encodedByteLength + 1 }, /misstated.*length/iu],
	];
	for (const [response, expectedError] of invalid) {
		const adapter = createSoundscaperPersistentDeliveryQueueAdapterV1({
			...options, queue: { ...options.queue, enqueue: async () => response as never },
		});
		await assert.rejects(adapter.enqueue({ description: description(), signal }), expectedError);
	}
	assert.equal(accessorCalls, 0);
});

test('invalid and already aborted queue signals do not reach the port', async () => {
	const options = queueOptions();
	let calls = 0;
	const adapter = createSoundscaperPersistentDeliveryQueueAdapterV1({
		...options,
		queue: { ...options.queue, events: async () => { calls += 1; return null; } },
	});
	await assert.rejects(adapter.events({ signal: null as never }), /AbortSignal/iu);
	const controller = new AbortController();
	const failure = new Error('queue operation cancelled');
	controller.abort(failure);
	await assert.rejects(adapter.events({ signal: controller.signal }), (error: unknown) => error === failure);
	assert.equal(calls, 0);
});

test('render execution requires a host and every publication authority callback', async () => {
	const options = renderOptions();
	const invalid: readonly [unknown, RegExp][] = [
		[{ ...options, host: null }, /render job host/iu],
		[{ ...options, currentAuthority: null }, /current-authority resolver/iu],
		[{ ...options, acquirePublicationFence: null }, /publication-fence resolver/iu],
		[{ ...options, validateExactResult: null }, /exact-result validator/iu],
	];
	for (const [value, expectedError] of invalid) {
		await assert.rejects(executeSoundscaperDeliveryRenderJobV1(value as never), expectedError);
	}
});

test('a host that returns no usable job still has its destination staging aborted', async () => {
	for (const returned of [null, { read: async () => null, result: null, cancel: async () => undefined }]) {
		const order: string[] = [];
		const options = renderOptions(order);
		await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
			...options, host: { open: async () => returned as never },
		}), /returned (no|an invalid) job/iu);
		assert.deepEqual(order, ['abort']);
	}
});

test('unvalidated progress is delivered in order before the render result is published', async () => {
	const order: string[] = [];
	const options = renderOptions(order);
	let progressRead = false;
	const received: unknown[] = [];
	const execution = await executeSoundscaperDeliveryRenderJobV1({
		...options,
		host: {
			open: async (request) => {
				const job = await options.host.open(request);
				return {
					...job,
					read: async () => {
						if (progressRead) return null;
						progressRead = true;
						return message(SOUNDSCAPER_DELIVERY_PROGRESS_MESSAGE_TYPE, { completed: 4 });
					},
					result: async () => createBoundedPortMessage(SOUNDSCAPER_DELIVERY_RESULT_MESSAGE_TYPE,
						result(description()), { sequence: 1, maximumEncodedBytes: 4_096 }),
				};
			},
		},
		onProgress: async (progress) => { received.push(progress); order.push('progress'); },
	});
	assert.deepEqual(received, [{ completed: 4 }]);
	assert.deepEqual(order, ['write', 'progress', 'commit']);
	assert.equal(execution.receipt.bytesWritten, 4);
});

test('render failures preserve cleanup failures and use fresh cancellation signals', async () => {
	const order: string[] = [];
	const options = renderOptions(order);
	const controller = new AbortController();
	const renderFailure = new Error('render cancelled');
	const cancelFailure = new Error('job cancellation failed');
	const abortFailure = new Error('staging cleanup failed');
	const cleanupSignals: AbortSignal[] = [];
	await assert.rejects(executeSoundscaperDeliveryRenderJobV1({
		...options,
		signal: controller.signal,
		destination: boundDestination({
			...writer(order),
			abort: async (request) => {
				order.push('abort'); cleanupSignals.push(request.signal);
				assert.equal(request.reason, renderFailure);
				throw abortFailure;
			},
		}),
		host: {
			open: async () => ({
				read: async () => { controller.abort(renderFailure); throw renderFailure; },
				result: async () => { throw new Error('result must not be read'); },
				cancel: async (request) => {
					order.push('cancel'); cleanupSignals.push(request.signal);
					assert.equal(request.reason, renderFailure);
					throw cancelFailure;
				},
			}),
		},
	}), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [renderFailure, cancelFailure, abortFailure]);
		assert.equal(error.cause, renderFailure);
		return true;
	});
	assert.deepEqual(order, ['cancel', 'abort']);
	assert.equal(cleanupSignals.length, 2);
	assert.equal(cleanupSignals[0], cleanupSignals[1]);
	assert.ok(cleanupSignals.every((cleanup) => !cleanup.aborted && cleanup !== controller.signal));
});
