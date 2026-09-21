/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_OPERATION_IPC_CHANNELS,
	registerAssistanceOperationIpc,
} from '../desktop/assistance-operation-main-ipc.ts';

function harness(
	overrides: Readonly<Record<string, unknown>> = {},
	confirmOperation: (request: unknown) => Promise<boolean> = async () => true,
	onError?: (error: unknown) => void,
) {
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
		dispose: async () => undefined,
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
		confirmOperation,
		onError,
	});
	return { handlers, listeners, sent, order, registration, built: () => built, operations, transfers };
}

test('run requires main-owned consent bound to the exact validated request', async () => {
	const seen: unknown[] = [];
	let runs = 0;
	const request = operationRequest();
	const declined = harness({ run: async () => { runs += 1; } }, async (value) => {
		seen.push(value);
		return false;
	});

	assert.deepEqual(await declined.handlers.get(ASSISTANCE_OPERATION_IPC_CHANNELS.run)?.(null, request), {
		contractVersion: 1,
		jobId: '1'.repeat(40),
		operation: 'speech-recognition',
		outcome: 'consent-declined',
	});
	assert.equal(runs, 0, 'declining the trusted prompt never enters operation execution');
	assert.deepEqual(seen, [request]);

	let confirmed: unknown = null;
	let executed: unknown = null;
	const accepted = harness({ run: async (value: unknown) => {
		executed = value;
		return { completed: true };
	} }, async (value) => { confirmed = value; return true; });
	assert.deepEqual(
		await accepted.handlers.get(ASSISTANCE_OPERATION_IPC_CHANNELS.run)?.(null, request),
		{ completed: true },
	);
	assert.equal(executed, confirmed, 'the exact frozen request confirmed in main is the one executed');
});

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
	const original = new Error('ENOENT /Users/alice/private.wav');
	const observed: unknown[] = [];
	const fixture = harness({ run: async () => { throw original; } }, async () => true,
		(error) => { observed.push(error); });
	await assert.rejects(Promise.resolve(fixture.handlers.get(
		ASSISTANCE_OPERATION_IPC_CHANNELS.run)?.(null, operationRequest())), (error: unknown) => {
		assert.equal(error instanceof Error ? error.message : '', 'The assistance operation could not be completed.');
		assert.notEqual(error, original);
		assert.equal(error instanceof Error ? error.cause : undefined, undefined);
		assert.doesNotMatch(String(error), /alice|private|ENOENT/u);
		assert.doesNotMatch(error instanceof Error ? error.stack ?? '' : '', /alice|private|ENOENT/u);
		return true;
	});
	assert.equal(observed.length, 1);
	assert.equal(observed[0], original);
});

test('failure observer exceptions cannot replace the redacted reply', async () => {
	const original = new Error('ENOENT /Users/alice/private.wav');
	let observed: unknown;
	const fixture = harness({ run: async () => { throw original; } }, async () => true,
		(error) => {
			observed = error;
			throw new Error('Observer failed /Users/alice/diagnostics.log');
		});
	await assert.rejects(Promise.resolve(fixture.handlers.get(
		ASSISTANCE_OPERATION_IPC_CHANNELS.run)?.(null, operationRequest())), {
		message: 'The assistance operation could not be completed.',
	});
	assert.equal(observed, original);
});

test('invalid requests report their original validation failure without creating a service', async () => {
	const observed: unknown[] = [];
	const fixture = harness({}, async () => true, (error) => { observed.push(error); });
	await assert.rejects(Promise.resolve(fixture.handlers.get(
		ASSISTANCE_OPERATION_IPC_CHANNELS.run)?.(null, {})), {
		message: 'The assistance operation could not be completed.',
	});
	assert.equal(observed.length, 1);
	assert.ok(observed[0] instanceof TypeError);
	assert.equal(fixture.built(), 0);
});

test('every pathless handler reports its original operation or transfer failure', async () => {
	const original = new Error('Native operation failed /private/input');
	const observed: unknown[] = [];
	const fail = (): never => { throw original; };
	const fixture = harness({ models: fail, createJob: fail, reserveOutput: fail,
		run: fail, cancel: fail, release: fail }, async () => true,
	(error) => { observed.push(error); });
	fixture.transfers.prepareInput = fail;
	fixture.transfers.awaitInput = fail;
	fixture.transfers.prepareOutput = fail;
	const calls = [
		[ASSISTANCE_OPERATION_IPC_CHANNELS.models, undefined],
		[ASSISTANCE_OPERATION_IPC_CHANNELS.create, undefined],
		[ASSISTANCE_OPERATION_IPC_CHANNELS.stage, { operation: 'prepare', jobId: '1'.repeat(40),
			role: 'audio', mediaType: 'audio/wav', byteLength: 4, sha256: 'a'.repeat(64) }],
		[ASSISTANCE_OPERATION_IPC_CHANNELS.stage, { operation: 'await', jobId: '1'.repeat(40),
			streamId: '2'.repeat(40) }],
		[ASSISTANCE_OPERATION_IPC_CHANNELS.reserve, {}],
		[ASSISTANCE_OPERATION_IPC_CHANNELS.run, operationRequest()],
		[ASSISTANCE_OPERATION_IPC_CHANNELS.cancel, '1'.repeat(40)],
		[ASSISTANCE_OPERATION_IPC_CHANNELS.readOutput, {}],
		[ASSISTANCE_OPERATION_IPC_CHANNELS.release, '1'.repeat(40)],
	] as const;
	for (const [channel, value] of calls) {
		await assert.rejects(Promise.resolve(fixture.handlers.get(channel)?.(null, value)),
			(error: unknown) => {
				assert.doesNotMatch(String(error), /Native|private/u);
				return true;
			});
	}
	assert.equal(observed.length, calls.length);
	assert.ok(observed.every((error) => error === original));
});

function operationRequest() {
	return Object.freeze({
		contractVersion: 1,
		jobId: '1'.repeat(40),
		operation: 'speech-recognition',
		selectionFence: Object.freeze({
			projectId: 'project-1', schemaFamily: 'soundscaper' as const,
			schemaVersion: 1, revision: 1, sequenceId: 'sequence-1',
			occurrenceIds: Object.freeze(['occurrence-1']), sourceId: 'source-1', sourceSha256: '2'.repeat(64),
			sourceStartFrame: 0, sourceEndFrame: 48_000,
			linkMembershipSha256: '3'.repeat(64), timingAuthoritySha256: '4'.repeat(64),
		}),
		models: Object.freeze([Object.freeze({ modelId: 'parakeet-tdt-0.6b-v2', version: '2.0.0',
			artifactSha256s: Object.freeze(['5'.repeat(64)]) })]),
		inputs: Object.freeze([Object.freeze({ claimVersion: 1, claimId: '6'.repeat(40),
			jobId: '1'.repeat(40), role: 'audio', mediaType: 'audio/wav', byteLength: 4,
			sha256: '7'.repeat(64) })]),
		outputs: Object.freeze([Object.freeze({ claimVersion: 1, claimId: '8'.repeat(40),
			jobId: '1'.repeat(40), role: 'transcript', mediaType: 'application/json',
			maximumByteLength: 4_096 })]),
	});
}

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

test('operation IPC disposal orders transfers before operations and retains either failure', async () => {
	const fixture = harness();
	await fixture.handlers.get(ASSISTANCE_OPERATION_IPC_CHANNELS.create)?.(null);
	const disposed: string[] = [];
	fixture.transfers.dispose = async () => { disposed.push('transfers'); throw new Error('transfer cleanup failed'); };
	fixture.operations.dispose = async () => { disposed.push('operations'); throw new Error('operation cleanup failed'); };
	await assert.rejects(fixture.registration.dispose(), (error: unknown) => error instanceof AggregateError
		&& error.errors.length === 2);
	assert.deepEqual(disposed, ['transfers', 'operations']);
});
