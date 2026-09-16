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

function workerFixture(): AudioEncodeStreamWorkerPort & { requests: AudioEncodeStreamRequest[]; terminated: boolean; reply(bytes?: Uint8Array): void } {
	let onMessage: ((event: MessageEvent<AudioEncodeStreamResponse>) => void) | undefined;
	return {
		requests: [], terminated: false,
		postMessage(message) { this.requests.push(message); }, terminate() { this.terminated = true; },
		addEventListener(type, listener) { if (type === 'message') onMessage = listener as typeof onMessage; },
		reply(bytes = new Uint8Array()) {
			onMessage?.({ data: { id: this.requests.at(-1)!.id, status: 'ok', bytes: Uint8Array.from(bytes).buffer } } as MessageEvent<AudioEncodeStreamResponse>);
		},
	};
}
