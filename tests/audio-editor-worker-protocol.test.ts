/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	EDITOR_WORKER_PROTOCOL_VERSION,
	WorkerBrokerDisposedError,
	WorkerProtocolError,
	WorkerRequestCancelledError,
	WorkerRequestTimeoutError,
	createWorkerRequestId,
} from '../src/common/editor/worker-protocol.ts';

test('worker request ids carry an explicit protocol version', () => {
	assert.equal(EDITOR_WORKER_PROTOCOL_VERSION, 1);
	assert.equal(createWorkerRequestId('staffpad', 42), 'staffpad:v1:42');
	assert.equal(createWorkerRequestId('AUP 4', 'session/2'), 'AUP-4:v1:session-2');
	assert.throws(() => createWorkerRequestId('', 1), /namespace and sequence/u);
});

test('worker lifecycle failures expose stable public codes', () => {
	assert.deepEqual(
		[
			new WorkerRequestTimeoutError(120_000),
			new WorkerRequestCancelledError(),
			new WorkerProtocolError(),
			new WorkerBrokerDisposedError(),
		].map(({ name, code }) => ({ name, code })),
		[
			{ name: 'TimeoutError', code: 'WORKER_INACTIVITY_TIMEOUT' },
			{ name: 'AbortError', code: 'WORKER_CANCELLED' },
			{ name: 'WorkerProtocolError', code: 'WORKER_PROTOCOL_FAILURE' },
			{ name: 'WorkerBrokerDisposedError', code: 'WORKER_BROKER_DISPOSED' },
		],
	);
});
