/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_OPERATION_IPC_CHANNELS,
	registerAssistanceOperationIpc,
} from '../desktop/assistance-operation-main-ipc.ts';

function harness(overrides: Readonly<Record<string, unknown>> = {}) {
	const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
	const listeners = new Map<string, (event: unknown, value?: unknown) => void>();
	const sent: unknown[] = [];
	const order: string[] = [];
	let built = 0;
	const operations = {
		models: async () => [],
		createJob: async () => ({ contractVersion: 1, jobId: '1'.repeat(40) }),
		reserveOutput: async (value: unknown) => value,
		run: async (value: unknown) => value,
		cancel: async () => { order.push('operation-cancel'); return { contractVersion: 1,
			jobId: '1'.repeat(40), outcome: 'cancelled' }; },
		release: async () => { order.push('operation-release'); return true; },
		...overrides,
	};
	const transfers = {
		prepareInput: (value: unknown) => value,
		awaitInput: async (value: unknown) => value,
		acceptInputPort: async () => undefined,
		prepareOutput: async (value: unknown) => value,
		acceptOutputPort: async () => undefined,
		cancelJob: async () => { order.push('transfer-cancel'); },
		dispose: async () => undefined,
	};
	const registration = registerAssistanceOperationIpc({
		channels: ASSISTANCE_OPERATION_IPC_CHANNELS,
		handle: (channel, handler) => handlers.set(channel, handler),
		on: (channel, listener) => listeners.set(channel, listener),
		sendToRenderer: (_channel, value) => sent.push(value),
		createOperations: (onProgress) => {
			built += 1;
			onProgress({ contractVersion: 1, jobId: '1'.repeat(40), operation: 'speech-recognition',
				sequence: 0, phase: 'queued', completed: null, total: null });
			return operations as never;
		},
		createTransfers: () => transfers as never,
	});
	return { handlers, listeners, sent, order, registration, built: () => built, operations, transfers };
}

test('the operation service stays lazy and all pathless operations are registered', async () => {
	const fixture = harness();
	assert.equal(fixture.built(), 0);
	assert.deepEqual([...fixture.handlers.keys()].sort(), [
		ASSISTANCE_OPERATION_IPC_CHANNELS.cancel,
		ASSISTANCE_OPERATION_IPC_CHANNELS.create,
		ASSISTANCE_OPERATION_IPC_CHANNELS.models,
		ASSISTANCE_OPERATION_IPC_CHANNELS.readOutput,
		ASSISTANCE_OPERATION_IPC_CHANNELS.release,
		ASSISTANCE_OPERATION_IPC_CHANNELS.reserve,
		ASSISTANCE_OPERATION_IPC_CHANNELS.run,
		ASSISTANCE_OPERATION_IPC_CHANNELS.stage,
	].sort());
	await fixture.handlers.get(ASSISTANCE_OPERATION_IPC_CHANNELS.create)?.(null);
	assert.equal(fixture.built(), 1);
	assert.equal(fixture.sent.length, 1);
});

test('stage prepare and await use one closed control channel while ports stay out-of-band', async () => {
	const fixture = harness();
	const prepared = await fixture.handlers.get(ASSISTANCE_OPERATION_IPC_CHANNELS.stage)?.(null, {
		operation: 'prepare', jobId: '1'.repeat(40), role: 'audio', mediaType: 'audio/wav',
		byteLength: 4, sha256: 'a'.repeat(64),
	});
	assert.deepEqual(prepared, { jobId: '1'.repeat(40), role: 'audio', mediaType: 'audio/wav',
		byteLength: 4, sha256: 'a'.repeat(64) });
	const awaited = await fixture.handlers.get(ASSISTANCE_OPERATION_IPC_CHANNELS.stage)?.(null, {
		operation: 'await', jobId: '1'.repeat(40), streamId: '2'.repeat(40),
	});
	assert.deepEqual(awaited, { jobId: '1'.repeat(40), streamId: '2'.repeat(40) });
	await assert.rejects(Promise.resolve(fixture.handlers.get(
		ASSISTANCE_OPERATION_IPC_CHANNELS.stage)?.(null, { operation: 'write', path: '/private' })),
	/assistance input could not be staged/iu);
});

test('native failures are redacted before crossing the control bridge', async () => {
	const fixture = harness({ run: async () => { throw new Error('ENOENT /Users/alice/private.wav'); } });
	await assert.rejects(Promise.resolve(fixture.handlers.get(
		ASSISTANCE_OPERATION_IPC_CHANNELS.run)?.(null, {})), (error: unknown) => {
		assert.equal(error instanceof Error ? error.message : '', 'The assistance operation could not be completed.');
		assert.doesNotMatch(String(error), /alice|private|ENOENT/u);
		return true;
	});
});

test('cancel and release quiesce transfers before operation staging is removed', async () => {
	const fixture = harness();
	await fixture.handlers.get(ASSISTANCE_OPERATION_IPC_CHANNELS.cancel)?.(null, '1'.repeat(40));
	assert.deepEqual(fixture.order, ['transfer-cancel', 'operation-cancel']);
	fixture.order.length = 0;
	await fixture.handlers.get(ASSISTANCE_OPERATION_IPC_CHANNELS.release)?.(null, '1'.repeat(40));
	assert.deepEqual(fixture.order, ['transfer-cancel', 'operation-release']);
});

test('port listeners accept exactly one structural MessagePort and close malformed offers', async () => {
	const fixture = harness();
	let accepted = 0;
	fixture.transfers.acceptInputPort = async () => { accepted += 1; };
	const port = { postMessage() {}, on() {}, close() { this.closed = true; }, closed: false };
	fixture.listeners.get(ASSISTANCE_OPERATION_IPC_CHANNELS.inputPort)?.({ ports: [port] }, {});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(accepted, 1);
	const first = { ...port, closed: false, close() { this.closed = true; } };
	const second = { ...first };
	fixture.listeners.get(ASSISTANCE_OPERATION_IPC_CHANNELS.outputPort)?.({ ports: [first, second] }, {});
	assert.equal(first.closed, true);
	assert.equal(second.closed, true);
});
