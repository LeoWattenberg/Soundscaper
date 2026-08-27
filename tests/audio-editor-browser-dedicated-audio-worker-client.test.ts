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

function workerHarness() {
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
		let posted: PostedRequest | null = null;
		const port = {
			terminationCount: 0,
			postMessage(message: PostedRequest) { posted = message; },
			terminate() { port.terminationCount += 1; },
			addEventListener(type: EventType, listener: Listener) { listeners[type].push(listener); },
			dispatch(type: 'error' | 'messageerror') {
				for (const listener of listeners[type]) listener({});
			},
			succeed(bytes: Uint8Array<ArrayBuffer>) {
				if (!posted) throw new Error('The fake worker has no posted request.');
				for (const listener of listeners.message) listener({
					data: { id: posted.id, status: 'ok', operation: posted.operation, bytes: bytes.buffer },
				});
			},
		};
		return port;
	}
}
