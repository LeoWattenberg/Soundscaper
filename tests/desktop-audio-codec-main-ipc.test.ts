/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	registerDesktopAudioCodecMainIpc,
	type DesktopAudioCodecMainIpcOptions,
	type DesktopAudioCodecMainIpcService,
} from '../desktop/desktop-audio-codec-main-ipc.ts';
import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';

const CHANNELS = Object.freeze({
	desktopAudioCodecExecute: 'soundscaper:v1:codecs:audio:execute',
	desktopAudioCodecCancel: 'soundscaper:v1:codecs:audio:cancel',
	desktopAudioCodecCapabilities: 'soundscaper:v1:codecs:audio:capabilities',
});

test('capability query is owned, closed, and result-sanitized', async () => {
	const fixture = registrationFixture();
	const query = capabilityQuery();
	const result = await fixture.invoke(CHANNELS.desktopAudioCodecCapabilities, fixture.event, query);
	assert.equal(fixture.capabilityQueries.length, 1);
	assert.notEqual(fixture.capabilityQueries[0], query);
	assert.deepEqual(result, capabilityResult(query));
	await assert.rejects(
		fixture.invoke(CHANNELS.desktopAudioCodecCapabilities, fixture.event, { ...query, executablePath: '/tmp/ffmpeg' }),
		/inexact shape/u,
	);
	const malicious = registrationFixture({
		capabilities: async (request) => ({
			...capabilityResult(request), executablePath: '/tmp/ffmpeg',
		}),
	});
	await assert.rejects(
		malicious.invoke(CHANNELS.desktopAudioCodecCapabilities, malicious.event, query),
		/inexact shape/u,
	);
	fixture.registration.dispose();
	malicious.registration.dispose();
});

test('execute requires a closed request ID and passes owned bytes to the main service', async () => {
	const fixture = registrationFixture();
	const input = new Uint8Array(8);
	const result = await fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(input));
	assert.deepEqual(result, { status: 'executed' });
	assert.equal(fixture.executions.length, 1);
	assert.notEqual(fixture.executions[0]?.request.input, input);
	input[0] = 255;
	assert.equal(fixture.executions[0]?.request.input[0], 0);
	assert.equal(fixture.executions[0]?.signal.aborted, false);

	await assert.rejects(
		fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, {
			...encodeRequest(new Uint8Array(8)), argv: ['-version'],
		}), /inexact shape/u,
	);
	await assert.rejects(
		fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, {
			...encodeRequest(new Uint8Array(8)), requestId: undefined,
		}), /request ID/u,
	);
	fixture.registration.dispose();
});

test('only the owning renderer can cancel its active request', async () => {
	const pending = deferred<unknown>();
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
			void pending.promise.then(resolve);
		}),
	});
	const running = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8)));
	await until(() => fixture.executions.length === 1);
	assert.equal(await fixture.invoke(CHANNELS.desktopAudioCodecCancel, { owner: {} }, 'audio-request-1'), false);
	assert.equal(fixture.executions[0]?.signal.aborted, false);
	assert.equal(await fixture.invoke(CHANNELS.desktopAudioCodecCancel, fixture.event, 'audio-request-1'), true);
	assert.deepEqual(await running, { status: 'cancelled' });
	assert.equal(await fixture.invoke(CHANNELS.desktopAudioCodecCancel, fixture.event, 'audio-request-1'), false);
	fixture.registration.dispose();
});

test('owner revocation aborts and drains every owned operation', async () => {
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve({ status: 'revoked' }), { once: true });
		}),
	});
	const running = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8)));
	await until(() => fixture.executions.length === 1);
	assert.equal(await fixture.registration.revokeOwner(fixture.owner), true);
	assert.deepEqual(await running, { status: 'revoked' });
	assert.equal(await fixture.registration.revokeOwner(fixture.owner), false);
	fixture.registration.dispose();
});

test('execute admits bounded per-owner and global operation counts before cloning', async () => {
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
		}),
	}, {
		maximumActiveOperationsPerOwner: 1,
		maximumActiveOperations: 2,
		maximumActiveInputBytes: 64,
	});
	const first = fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'owner-one'),
	);
	await until(() => fixture.executions.length === 1);
	await assert.rejects(fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'owner-one-second'),
	), /per-owner.*limit/iu);
	assert.equal(fixture.executions.length, 1);
	const secondOwner = {};
	const second = fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, { owner: secondOwner },
		encodeRequest(new Uint8Array(8), 'owner-two'),
	);
	await until(() => fixture.executions.length === 2);
	await assert.rejects(fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, { owner: {} },
		encodeRequest(new Uint8Array(8), 'owner-three'),
	), /global.*limit/iu);
	assert.equal(fixture.executions.length, 2);
	fixture.registration.dispose();
	await Promise.all([first, second]);
});

test('execute admits aggregate active input bytes before cloning', async () => {
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true });
		}),
	}, {
		maximumActiveOperationsPerOwner: 2,
		maximumActiveOperations: 4,
		maximumActiveInputBytes: 12,
	});
	const first = fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, fixture.event,
		encodeRequest(new Uint8Array(8), 'aggregate-one'),
	);
	await until(() => fixture.executions.length === 1);
	await assert.rejects(fixture.invoke(
		CHANNELS.desktopAudioCodecExecute, { owner: {} },
		encodeRequest(new Uint8Array(8), 'aggregate-two'),
	), /aggregate.*byte.*limit/iu);
	assert.equal(fixture.executions.length, 1);
	fixture.registration.dispose();
	await first;
});

test('dispose aborts jobs, removes both handlers, and is idempotent', async () => {
	const fixture = registrationFixture({
		execute: (_request, { signal }) => new Promise((resolve) => {
			signal.addEventListener('abort', () => resolve({ status: 'disposed' }), { once: true });
		}),
	});
	const running = fixture.invoke(CHANNELS.desktopAudioCodecExecute, fixture.event, encodeRequest(new Uint8Array(8)));
	await until(() => fixture.executions.length === 1);
	fixture.registration.dispose();
	fixture.registration.dispose();
	assert.deepEqual(await running, { status: 'disposed' });
	assert.deepEqual(fixture.removed, Object.values(CHANNELS));
});

test('registration validates unique channels and rolls back partial bindings', () => {
	assert.throws(() => registerDesktopAudioCodecMainIpc({
		channels: { ...CHANNELS, desktopAudioCodecCancel: CHANNELS.desktopAudioCodecExecute },
		handle() {}, removeHandler() {}, ownerFor: () => ({}), service: { execute: async () => null, capabilities: async () => null },
	}), /unique/u);
	const removed: string[] = [];
	assert.throws(() => registerDesktopAudioCodecMainIpc({
		channels: CHANNELS,
		handle(channel) { if (channel === CHANNELS.desktopAudioCodecCancel) throw new Error('binding failed'); },
		removeHandler: (channel) => { removed.push(channel); },
		ownerFor: () => ({}), service: { execute: async () => null, capabilities: async () => null },
	}), /binding failed/u);
	assert.deepEqual(removed, [CHANNELS.desktopAudioCodecExecute]);
});

function registrationFixture(
	overrides: Partial<DesktopAudioCodecMainIpcService> = {},
	limits: Pick<DesktopAudioCodecMainIpcOptions<object>,
		'maximumActiveOperationsPerOwner' | 'maximumActiveOperations' | 'maximumActiveInputBytes'> = {},
) {
	const handlers = new Map<string, (event: unknown, ...arguments_: unknown[]) => unknown>();
	const removed: string[] = [];
	const executions: Array<Readonly<{ request: ReturnType<typeof encodeRequest>; signal: AbortSignal }>> = [];
	const capabilityQueries: unknown[] = [];
	const owner = {};
	const event = { owner };
	const registration = registerDesktopAudioCodecMainIpc({
		...limits,
		channels: CHANNELS,
		handle: (channel, listener) => { handlers.set(channel, listener); },
		removeHandler: (channel) => { removed.push(channel); handlers.delete(channel); },
		ownerFor: (value) => (value as typeof event).owner,
		service: {
			capabilities: async (query) => {
				capabilityQueries.push(query);
				return overrides.capabilities
					? overrides.capabilities(query)
					: capabilityResult(query);
			},
			execute: async (request, options) => {
				executions.push({ request: request as ReturnType<typeof encodeRequest>, signal: options.signal });
				return overrides.execute
					? overrides.execute(request, options)
					: { status: 'executed' };
			},
		},
	});
	return {
		capabilityQueries, event, executions, owner, registration, removed,
		invoke: async (channel: string, invocationEvent: unknown, ...arguments_: unknown[]) => {
			const handler = handlers.get(channel);
			if (!handler) throw new Error('Missing IPC handler.');
			return handler(invocationEvent, ...arguments_);
		},
	};
}

function capabilityQuery() {
	return {
		schemaVersion: 2 as const,
		operations: [{
			operation: 'audio-encode' as const, format: 'opus' as const,
			sampleRate: 48_000, channelCount: 2, settings: { bitrateKbps: 128 },
		}],
	};
}

function capabilityResult(query: DesktopAudioCodecCapabilityQuery) {
	return {
		schemaVersion: 2 as const,
		capabilities: query.operations.map((operation) => ({
			...operation, available: false as const, provider: null,
			reason: 'configure-external-ffmpeg' as const,
		})),
	};
}

function encodeRequest(input: Uint8Array, requestId = 'audio-request-1') {
	return {
		operation: 'audio-encode' as const, format: 'opus' as const, input,
		sampleRate: 48_000, channelCount: 2, settings: { bitrateKbps: 128 },
		maximumOutputBytes: 8_192, requestId,
	};
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	throw new Error('Condition was not reached.');
}
