/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openBrowserAudioEncodeStreamSession, type AudioEncodeStreamRequest, type AudioEncodeStreamResponse, type AudioEncodeStreamWorkerPort } from '../src/common/editor/browser-audio-encode-stream-client.ts';

const request = { format: 'mp3' as const, frameCount: 20_000, channelCount: 2, sampleRate: 48_000, settings: { bitrateKbps: 192 } };
test('worker packets are bounded before transfer and overlapping writes are refused', async () => {
	const worker = workerFixture();
	const opening = openBrowserAudioEncodeStreamSession(request, { createWorker: () => worker });
	worker.reply(); const session = await opening;
	const oversized = session.write(new Uint8Array(16_385 * 8), 16_385);
	worker.reply(); await assert.rejects(oversized, /packet geometry/iu);
	assert.equal(worker.requests.length, 1);
	const pending = session.write(new Uint8Array(10 * 8), 10);
	await assert.rejects(session.write(new Uint8Array(10 * 8), 10), /awaited in order/iu);
	worker.reply(Uint8Array.of(1, 2)); assert.deepEqual(await pending, Uint8Array.of(1, 2));
	session.close(); assert.equal(worker.terminated, true);
});

test('cancellation terminates the worker and rejects a PCM request without waiting for codec completion', async () => {
	const worker = workerFixture(); const abort = new AbortController();
	const opening = openBrowserAudioEncodeStreamSession(request, { signal: abort.signal, createWorker: () => worker });
	worker.reply(); const session = await opening;
	const pending = session.write(new Uint8Array(80), 10);
	abort.abort(new DOMException('Cancelled', 'AbortError'));
	await assert.rejects(pending, { name: 'AbortError' }); assert.equal(worker.terminated, true);
	session.close();
});

test('a failed packet post closes the stateful session', async () => {
	const worker = workerFixture();
	const opening = openBrowserAudioEncodeStreamSession(request, { createWorker: () => worker });
	worker.reply();
	const session = await opening;
	worker.throwNextPost = true;
	await assert.rejects(session.write(new Uint8Array(80), 10), /clone failed/u);
	assert.equal(worker.terminated, true);
	await assert.rejects(session.write(new Uint8Array(80), 10), /awaited in order|closed/iu);
});

test('close rejects pending work even when worker termination throws', async () => {
	const worker = workerFixture();
	const opening = openBrowserAudioEncodeStreamSession(request, { createWorker: () => worker });
	worker.reply();
	const session = await opening;
	const pending = session.write(new Uint8Array(80), 10);
	worker.throwTerminate = true;
	assert.doesNotThrow(() => session.close());
	await assert.rejects(pending, /session was closed/u);
	assert.equal(worker.terminationCount, 1);
});

test('an encoder error response is terminal for the stateful stream', async () => {
	const worker = workerFixture();
	const opening = openBrowserAudioEncodeStreamSession(request, { createWorker: () => worker });
	worker.reply();
	const session = await opening;
	const pending = session.write(new Uint8Array(80), 10);
	worker.respond({ id: worker.requests.at(-1)!.id, status: 'error', message: 'encode failed' });

	await assert.rejects(pending, /encode failed/u);
	assert.equal(worker.terminated, true);
	await assert.rejects(session.write(new Uint8Array(80), 10), /awaited in order|closed/iu);
});

for (const failureType of ['error', 'messageerror'] as const) {
	test(`a worker ${failureType} is terminal for the stateful stream`, async () => {
		const worker = workerFixture();
		const opening = openBrowserAudioEncodeStreamSession(request, { createWorker: () => worker });
		worker.reply();
		const session = await opening;
		const pending = session.write(new Uint8Array(80), 10);
		worker.dispatch(failureType);

		await assert.rejects(pending, /worker failed/u);
		assert.equal(worker.terminated, true);
		await assert.rejects(session.finish(), /awaited in order|closed/iu);
	});
}

test('an abort raised by the stream worker factory retires the acquired port', async () => {
	const worker = workerFixture();
	const controller = new AbortController();
	const reason = new DOMException('Factory cancelled.', 'AbortError');
	const opening = openBrowserAudioEncodeStreamSession(request, {
		signal: controller.signal,
		createWorker() {
			controller.abort(reason);
			return worker;
		},
	});

	await assert.rejects(opening, (error: unknown) => error === reason);
	assert.equal(worker.terminated, true);
	assert.equal(worker.requests.length, 0);
});

test('stream requests do not arm inactivity deadlines', async () => {
	const originalSetTimeout = globalThis.setTimeout;
	globalThis.setTimeout = (() => { throw new Error('An inactivity deadline was armed.'); }) as unknown as typeof setTimeout;
	const worker = workerFixture();
	try {
		const opening = openBrowserAudioEncodeStreamSession(request, { createWorker: () => worker });
		worker.reply();
		const session = await opening;
		const pending = session.write(new Uint8Array(80), 10);
		worker.reply(Uint8Array.of(1));
		assert.deepEqual(await pending, Uint8Array.of(1));
		session.close();
	} finally {
		globalThis.setTimeout = originalSetTimeout;
	}
});

for (const response of ['malformed', 'wrong-id'] as const) {
	test(`a ${response} encoder response closes the session and settles the request`, async () => {
		const worker = workerFixture();
		const opening = openBrowserAudioEncodeStreamSession(request, { createWorker: () => worker });
		worker.reply();
		const session = await opening;
		const pending = session.write(new Uint8Array(80), 10);
		if (response === 'malformed') worker.respond({ id: worker.requests.at(-1)!.id, status: 'ok', bytes: 'not bytes' });
		else worker.respond({ id: worker.requests.at(-1)!.id + 1, status: 'ok', bytes: new ArrayBuffer(0) });

		await assert.rejects(pending, /malformed|unexpected/iu);
		assert.equal(worker.terminated, true);
		worker.reply(Uint8Array.of(9));
	});
}

function workerFixture(): AudioEncodeStreamWorkerPort & {
	requests: AudioEncodeStreamRequest[];
	terminated: boolean;
	terminationCount: number;
	throwNextPost: boolean;
	throwTerminate: boolean;
	reply(bytes?: Uint8Array): void;
	respond(response: unknown): void;
	dispatch(type: 'error' | 'messageerror'): void;
} {
	type EventType = 'message' | 'error' | 'messageerror';
	type Listener = (event: MessageEvent<AudioEncodeStreamResponse> | Event) => void;
	const listeners: Record<EventType, Listener[]> = { message: [], error: [], messageerror: [] };
	return {
		requests: [], terminated: false, terminationCount: 0, throwNextPost: false, throwTerminate: false,
		postMessage(message) {
			if (this.throwNextPost) {
				this.throwNextPost = false;
				throw new Error('clone failed');
			}
			this.requests.push(message);
		},
		terminate() {
			this.terminated = true;
			this.terminationCount += 1;
			if (this.throwTerminate) throw new Error('terminate failed');
		},
		addEventListener(type, listener) { listeners[type].push(listener as Listener); },
		respond(response) {
			for (const listener of listeners.message) listener({ data: response } as MessageEvent<AudioEncodeStreamResponse>);
		},
		dispatch(type) { for (const listener of listeners[type]) listener(new Event(type)); },
		reply(bytes = new Uint8Array()) {
			this.respond({ id: this.requests.at(-1)!.id, status: 'ok', bytes: Uint8Array.from(bytes).buffer });
		},
	};
}
