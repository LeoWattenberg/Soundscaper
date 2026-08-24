/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createBoundedPortMessage } from '../src/common/editor/platform/bounded-transfer.ts';
import type { PersistentRenderQueuePortV1 } from '../src/common/editor/platform/persistent-render-queue-port.ts';
import type { SoundscaperDeliveryDescriptionV1 } from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import { createSoundscaperPersistentDeliveryQueueAdapterV1 } from '../src/common/editor/controller/soundscaper-persistent-delivery-adapter-v1.ts';
import { description } from './helpers/soundscaper-delivery-adapter-fixtures.ts';

test('the persistent adapter bounds descriptions and validates summaries and events', async () => {
	const calls: Array<readonly [string, unknown]> = [];
	const queue: PersistentRenderQueuePortV1<SoundscaperDeliveryDescriptionV1, unknown, unknown> = {
		enqueue: async (request) => {
			calls.push(['enqueue', request]);
			return createBoundedPortMessage('queue-summary-v1', { jobId: 'job-01', state: 'queued' }, {
				sequence: 9, maximumEncodedBytes: 1_024,
			});
		},
		list: async (request) => {
			calls.push(['list', request]);
			return createBoundedPortMessage('queue-list-v1', [{ jobId: 'job-01', state: 'queued' }], {
				sequence: 10, maximumEncodedBytes: 1_024,
			});
		},
		events: async (request) => {
			calls.push(['events', request]);
			return createBoundedPortMessage('queue-event-v1', { type: 'changed', jobId: 'job-01' }, {
				sequence: 11, maximumEncodedBytes: 1_024,
			});
		},
		reorder: async (request) => { calls.push(['reorder', request]); },
		pause: async (request) => { calls.push(['pause', request]); },
		resume: async (request) => { calls.push(['resume', request]); },
		cancel: async (request) => { calls.push(['cancel', request]); },
		retry: async (request) => { calls.push(['retry', request]); },
	};
	const adapter = createSoundscaperPersistentDeliveryQueueAdapterV1({
		queue,
		summaryMessageType: 'queue-summary-v1',
		listMessageType: 'queue-list-v1',
		eventMessageType: 'queue-event-v1',
		validateSummary: (value) => {
			const row = value as { jobId?: unknown; state?: unknown };
			if (typeof row?.jobId !== 'string' || row.state !== 'queued') throw new TypeError('bad summary');
			return Object.freeze({ jobId: row.jobId, state: row.state });
		},
		validateEvent: (value) => {
			const row = value as { type?: unknown; jobId?: unknown };
			if (row?.type !== 'changed' || typeof row.jobId !== 'string') throw new TypeError('bad event');
			return Object.freeze({ type: row.type, jobId: row.jobId });
		},
	});
	const controller = new AbortController();
	assert.deepEqual(await adapter.enqueue({ description: description(), signal: controller.signal }), {
		jobId: 'job-01', state: 'queued',
	});
	assert.deepEqual(await adapter.list({ limit: 25, cursor: 'page-2', signal: controller.signal }), [{
		jobId: 'job-01', state: 'queued',
	}]);
	assert.deepEqual(await adapter.events({ signal: controller.signal }), {
		type: 'changed', jobId: 'job-01',
	});
	await adapter.reorder({ jobId: 'job-01', position: 3, signal: controller.signal });
	await adapter.pause({ jobId: 'job-01', signal: controller.signal });
	await adapter.resume({ jobId: 'job-01', signal: controller.signal });
	await adapter.cancel({ jobId: 'job-01', signal: controller.signal });
	await adapter.retry({ jobId: 'job-01', signal: controller.signal });

	const enqueueCall = calls[0]?.[1] as { description?: { type?: string; payload?: unknown }; signal?: AbortSignal };
	assert.equal(enqueueCall.description?.type, 'soundscaper-delivery-description-v1');
	assert.deepEqual(enqueueCall.description?.payload, description());
	assert.equal(enqueueCall.signal, controller.signal);
	assert.deepEqual(calls.slice(3).map(([name]) => name), ['reorder', 'pause', 'resume', 'cancel', 'retry']);
});

test('the persistent adapter refuses malformed port messages and unbounded requests', async () => {
	const message = createBoundedPortMessage('wrong-type', { jobId: 'job-01' }, {
		sequence: 0, maximumEncodedBytes: 1_024,
	});
	const queue = {
		enqueue: async () => message,
		list: async () => createBoundedPortMessage('queue-list-v1', [], { sequence: 0, maximumEncodedBytes: 64 }),
		events: async () => null,
		reorder: async () => undefined, pause: async () => undefined, resume: async () => undefined,
		cancel: async () => undefined, retry: async () => undefined,
	} satisfies PersistentRenderQueuePortV1<SoundscaperDeliveryDescriptionV1, unknown, unknown>;
	const adapter = createSoundscaperPersistentDeliveryQueueAdapterV1({
		queue, summaryMessageType: 'queue-summary-v1', listMessageType: 'queue-list-v1',
		eventMessageType: 'queue-event-v1', validateSummary: (value) => value,
		validateEvent: (value) => value,
	});
	const signal = new AbortController().signal;
	await assert.rejects(adapter.enqueue({ description: description(), signal }), /message type/iu);
	await assert.rejects(adapter.list({ limit: 0, signal }), /page limit/iu);
	await assert.rejects(adapter.pause({ jobId: '../job', signal }), /job id/iu);
	await assert.rejects(adapter.reorder({ jobId: 'job-01', position: -1, signal }), /position/iu);

	// The transport envelope is a closed shape like every other surface of this
	// contract: an extra field refuses instead of being re-encoded away.
	const decorated = createSoundscaperPersistentDeliveryQueueAdapterV1({
		queue: {
			...queue,
			list: async () => Object.freeze({
				...createBoundedPortMessage('queue-list-v1', [], { sequence: 0, maximumEncodedBytes: 64 }),
				extra: true,
			}) as never,
		},
		summaryMessageType: 'queue-summary-v1', listMessageType: 'queue-list-v1',
		eventMessageType: 'queue-event-v1', validateSummary: (value) => value,
		validateEvent: (value) => value,
	});
	await assert.rejects(decorated.list({ limit: 1, signal }), /unsupported message fields/iu);
});

test('persistent queue event envelopes must advance monotonically', async () => {
	const adapter = queueAdapterWithEvents([
		createBoundedPortMessage('queue-event-v1', { type: 'changed' }, {
			sequence: 7, maximumEncodedBytes: 1_024,
		}),
		createBoundedPortMessage('queue-event-v1', { type: 'changed' }, {
			sequence: 7, maximumEncodedBytes: 1_024,
		}),
	]);
	const signal = new AbortController().signal;
	assert.deepEqual(await adapter.events({ signal }), { type: 'changed' });
	await assert.rejects(adapter.events({ signal }), /event sequence must increase/iu);

	// The port scopes sequences to one subscription: after the stream ends with
	// null, a re-subscribed binding numbers from zero again, and the adapter
	// must admit that instead of staying wedged on the old floor.
	const resubscribed = queueAdapterWithEvents([
		createBoundedPortMessage('queue-event-v1', { type: 'changed' }, {
			sequence: 5, maximumEncodedBytes: 1_024,
		}),
		null as never,
		createBoundedPortMessage('queue-event-v1', { type: 'restarted' }, {
			sequence: 0, maximumEncodedBytes: 1_024,
		}),
	]);
	assert.deepEqual(await resubscribed.events({ signal }), { type: 'changed' });
	assert.equal(await resubscribed.events({ signal }), null);
	assert.deepEqual(await resubscribed.events({ signal }), { type: 'restarted' });
});

test('persistent queue messages are structurally budgeted before JSON re-encoding', async () => {
	const adapter = queueAdapterWithEvents([
		createBoundedPortMessage('queue-event-v1', {
			type: 'changed', values: Array.from({ length: 9_000 }, () => null),
		}, { sequence: 1, maximumEncodedBytes: 64 * 1_024 }),
	]);
	await assert.rejects(
		adapter.events({ signal: new AbortController().signal }),
		/structural node budget/iu,
	);
});

function queueAdapterWithEvents(
	events: readonly ReturnType<typeof createBoundedPortMessage>[],
) {
	let eventIndex = 0;
	const queue: PersistentRenderQueuePortV1<SoundscaperDeliveryDescriptionV1, unknown, unknown> = {
		enqueue: async () => createBoundedPortMessage('queue-summary-v1', {}, {
			sequence: 0, maximumEncodedBytes: 1_024,
		}),
		list: async () => createBoundedPortMessage('queue-list-v1', [], {
			sequence: 0, maximumEncodedBytes: 1_024,
		}),
		events: async () => events[eventIndex++] ?? null,
		reorder: async () => undefined, pause: async () => undefined,
		resume: async () => undefined, cancel: async () => undefined, retry: async () => undefined,
	};
	return createSoundscaperPersistentDeliveryQueueAdapterV1({
		queue,
		summaryMessageType: 'queue-summary-v1',
		listMessageType: 'queue-list-v1',
		eventMessageType: 'queue-event-v1',
		validateSummary: (value) => value, validateEvent: (value) => value,
	});
}
