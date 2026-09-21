/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createBrowserDedicatedAudioCodecClient,
} from '../src/common/editor/browser-dedicated-audio-worker-client.ts';
import type { DedicatedAudioEncodeRequest } from '../src/common/editor/browser-dedicated-audio-codec.ts';

for (const failureType of ['error', 'messageerror'] as const) {
	test(`a late ${failureType} from a replaced worker cannot terminate the current worker`, async () => {
		const harness = workerHarness();
		const client = createBrowserDedicatedAudioCodecClient({ createWorker: harness.createWorker });
		const controller = new AbortController();
		const first = client.encode(encodeRequest(1), { signal: controller.signal });
		const oldWorker = await harness.nextWorker();
		controller.abort();
		await assert.rejects(first, (error: Error) => error.name === 'AbortError');
		assert.equal(oldWorker.terminationCount, 1);

		const second = client.encode(encodeRequest(2));
		const currentWorker = await harness.nextWorker();
		oldWorker.dispatch(failureType);
		assert.equal(currentWorker.terminationCount, 0, 'the obsolete port cannot clear the replacement');
		currentWorker.succeed(Uint8Array.of(7, 8, 9));

		assert.deepEqual([...(await second)], [7, 8, 9]);
		assert.equal(currentWorker.terminationCount, 0);
		client.dispose();
	});
}

test('a failure from the current worker still rejects pending work and permits a replacement', async () => {
	const harness = workerHarness();
	const client = createBrowserDedicatedAudioCodecClient({ createWorker: harness.createWorker });
	const first = client.encode(encodeRequest(1));
	const failedWorker = await harness.nextWorker();
	failedWorker.dispatch('error');

	await assert.rejects(first, /dedicated audio worker failed/u);
	assert.equal(failedWorker.terminationCount, 1);

	const second = client.encode(encodeRequest(2));
	const replacement = await harness.nextWorker();
	replacement.succeed(Uint8Array.of(4, 5));
	assert.deepEqual([...(await second)], [4, 5]);
	client.dispose();
	assert.equal(replacement.terminationCount, 1);
});

test('a queued abort settles immediately without terminating the active worker', async () => {
	const harness = workerHarness();
	const client = createBrowserDedicatedAudioCodecClient({ createWorker: harness.createWorker });
	const first = client.encode(encodeRequest(1));
	const worker = await harness.nextWorker();
	const controller = new AbortController();
	const queued = client.encode(encodeRequest(2), { signal: controller.signal });
	controller.abort(new DOMException('Queued operation cancelled.', 'AbortError'));

	await assert.rejects(queued, /Queued operation cancelled/u);
	assert.equal(worker.terminationCount, 0);
	assert.equal(worker.requests.length, 1);
	worker.succeed(Uint8Array.of(1));
	assert.deepEqual([...(await first)], [1]);
	client.dispose();
});

test('an active abort replaces the worker while preserving queued work', async () => {
	const harness = workerHarness();
	const client = createBrowserDedicatedAudioCodecClient({ createWorker: harness.createWorker });
	const controller = new AbortController();
	const first = client.encode(encodeRequest(1), { signal: controller.signal });
	const oldWorker = await harness.nextWorker();
	const queued = client.encode(encodeRequest(2));
	const reason = new DOMException('Active operation cancelled.', 'AbortError');
	controller.abort(reason);

	await assert.rejects(first, (error: unknown) => error === reason);
	assert.equal(oldWorker.terminationCount, 1);
	const replacement = await harness.nextWorker();
	assert.equal(replacement.requests.length, 1);
	replacement.succeed(Uint8Array.of(2));
	assert.deepEqual([...(await queued)], [2]);
	client.dispose();
});

test('an abort raised by the worker factory prevents posting and retires the acquired port', async () => {
	const controller = new AbortController();
	const reason = new DOMException('Factory cancelled.', 'AbortError');
	const harness = workerHarness(() => controller.abort(reason));
	const client = createBrowserDedicatedAudioCodecClient({ createWorker: harness.createWorker });
	const operation = client.encode(encodeRequest(1), { signal: controller.signal });
	const worker = await harness.nextWorker();

	await assert.rejects(operation, (error: unknown) => error === reason);
	assert.equal(worker.requests.length, 0);
	assert.equal(worker.terminationCount, 1);
	client.dispose();
});

test('a failed post is rolled back and the next queued operation still runs', async () => {
	const harness = workerHarness((worker) => { worker.throwNextPost = true; });
	const client = createBrowserDedicatedAudioCodecClient({ createWorker: harness.createWorker });
	const first = client.encode(encodeRequest(1));
	const worker = await harness.nextWorker();
	const second = client.encode(encodeRequest(2));

	await assert.rejects(first, /clone failed/u);
	assert.equal(worker.terminationCount, 0);
	assert.equal(worker.requests.length, 1);
	worker.succeed(Uint8Array.of(2));
	assert.deepEqual([...(await second)], [2]);
	client.dispose();
});

test('dispose rejects both active and queued operations even when termination throws', async () => {
	const harness = workerHarness();
	const client = createBrowserDedicatedAudioCodecClient({ createWorker: harness.createWorker });
	const active = client.encode(encodeRequest(1));
	const worker = await harness.nextWorker();
	worker.throwTerminate = true;
	const queued = client.encode(encodeRequest(2));
	client.dispose();

	await assert.rejects(active, /disposed/u);
	await assert.rejects(queued, /disposed/u);
	assert.equal(worker.terminationCount, 1);
	await assert.rejects(client.encode(encodeRequest(3)), /disposed/u);
});

test('dedicated requests do not arm inactivity deadlines', async () => {
	const originalSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = (() => { throw new Error('An inactivity deadline was armed.'); }) as unknown as typeof setTimeout;
	const harness = workerHarness();
	const client = createBrowserDedicatedAudioCodecClient({ createWorker: harness.createWorker });
	try {
		const result = client.encode(encodeRequest(1));
		const worker = await harness.nextWorker();
		worker.succeed(Uint8Array.of(1));
		assert.deepEqual([...(await result)], [1]);
	} finally {
		client.dispose();
		globalThis.setTimeout = originalSetTimeout;
	}
});

for (const response of ['malformed', 'wrong-id'] as const) {
	test(`a ${response} response rejects the active request and advances the queue on a replacement`, async () => {
		const harness = workerHarness();
		const client = createBrowserDedicatedAudioCodecClient({ createWorker: harness.createWorker });
		const active = client.encode(encodeRequest(1));
		const worker = await harness.nextWorker();
		const queued = client.encode(encodeRequest(2));
		if (response === 'malformed') worker.respond({ status: 'ok' });
		else worker.respond({ id: worker.requests[0]!.id + 1, status: 'ok', operation: 'encode', bytes: new ArrayBuffer(0) });

		await assert.rejects(active, /malformed|unexpected/iu);
		assert.equal(worker.terminationCount, 1);
		const replacement = await harness.nextWorker();
		replacement.succeed(Uint8Array.of(2));
		assert.deepEqual([...(await queued)], [2]);
		client.dispose();
	});
}

function encodeRequest(marker: number): DedicatedAudioEncodeRequest {
	return Object.freeze({
		format: 'mp3' as const,
		input: Uint8Array.of(marker, 0, 0, 0),
		frameCount: 1,
		channelCount: 1,
		sampleRate: 48_000,
		settings: Object.freeze({ bitrateKbps: 128 }),
		maximumOutputBytes: 1_024,
	});
}

function workerHarness(onCreate?: (worker: ReturnType<typeof createWorkerPort>) => void) {
	type EventType = 'message' | 'error' | 'messageerror';
	type Listener = (event: { data?: unknown }) => void;
	type PostedRequest = Readonly<{ id: number; operation: 'encode' | 'decode' }>;
	const workers: ReturnType<typeof createWorkerPort>[] = [];
	const waiters: ((worker: ReturnType<typeof createWorkerPort>) => void)[] = [];
	const createWorker = () => {
		const worker = createWorkerPort();
		const waiter = waiters.shift();
		if (waiter) waiter(worker);
		else workers.push(worker);
		onCreate?.(worker);
		return worker as never;
	};
	const nextWorker = (): Promise<ReturnType<typeof createWorkerPort>> => {
		const worker = workers.shift();
		if (worker) return Promise.resolve(worker);
		return new Promise((resolve) => { waiters.push(resolve); });
	};
	return Object.freeze({ createWorker, nextWorker });

	function createWorkerPort() {
		const listeners: Record<EventType, Listener[]> = { message: [], error: [], messageerror: [] };
		const port = {
			terminationCount: 0,
			requests: [] as PostedRequest[],
			throwNextPost: false,
			throwTerminate: false,
			postMessage(message: PostedRequest) {
				if (port.throwNextPost) {
					port.throwNextPost = false;
					throw new Error('clone failed');
				}
				port.requests.push(message);
			},
			terminate() {
				port.terminationCount += 1;
				if (port.throwTerminate) throw new Error('terminate failed');
			},
			addEventListener(type: EventType, listener: Listener) { listeners[type].push(listener); },
			dispatch(type: 'error' | 'messageerror') {
				for (const listener of listeners[type]) listener({});
			},
			respond(data: unknown) {
				for (const listener of listeners.message) listener({ data });
			},
			succeed(bytes: Uint8Array<ArrayBuffer>) {
				const posted = port.requests.at(-1);
				if (!posted) throw new Error('The fake worker has no posted request.');
				for (const listener of listeners.message) listener({
					data: { id: posted.id, status: 'ok', operation: posted.operation, bytes: bytes.buffer },
				});
			},
		};
		return port;
	}
}
