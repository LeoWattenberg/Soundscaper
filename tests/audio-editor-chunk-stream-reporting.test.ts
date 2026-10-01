/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ChunkStreamClient } from '../src/common/editor/chunk-stream-client.js';
import { ChunkStreamPlaybackProcessor } from '../src/common/editor/chunk-stream-worklet.js';
import { installChunkStreamWorker } from '../src/common/editor/chunk-stream-worker.js';
import { createImmutablePcmChunks } from '../src/common/editor/pcm-chunks.js';

interface StreamMessage {
	readonly type: string;
	readonly streamId?: string;
	readonly frame?: number;
	readonly progress?: number;
	readonly frames?: number;
	readonly [key: string]: unknown;
}

type MessageListener = (event: { readonly data: StreamMessage }) => void;

test('streams report only subscribed progress and playheads and retain packet delivery and completion', async () => {
	const fixture = createFixture();
	const source = createImmutablePcmChunks([new Float32Array(3_072).fill(0.5)]);
	try {
		// Reuse the same processor so a subscribed stream cannot enable its successor.
		for (const [progressEnabled, playheadEnabled] of [[false, false], [true, false], [false, true], [true, true], [false, false]]) {
			const progress: number[] = [];
			const playheads: number[] = [];
			const workerStart = fixture.worker.sent.length;
			const workletStart = fixture.processorPort.sent.length;
			const handle = fixture.client.open({
				source,
				outputPort: fixture.clientPort,
				highWaterMark: 4,
				onProgress: progressEnabled ? (value: { progress: number }): void => { progress.push(value.progress); } : null,
				onPlayhead: playheadEnabled ? (frame: number): void => { playheads.push(frame); } : null,
			});
			await handle.primed;
			await handle.play();
			for (let block = 0; block < 8; block += 1) {
				assert.ok(render(fixture.processor).every((sample) => sample === 0.5));
			}
			handle.pause();
			const beforePause = fixture.processorPort.sent.length;
			assert.ok(render(fixture.processor).every((sample) => sample === 0));
			assert.equal(fixture.processorPort.sent.length, beforePause);
			await handle.play();
			for (let block = 8; block < 24; block += 1) render(fixture.processor);
			assert.equal((await handle.done).frames, 3_072);
			assert.deepEqual(progress, progressEnabled ? [1 / 3, 2 / 3, 1] : []);
			assert.deepEqual(playheads, playheadEnabled ? [1_024, 2_048] : []);
			const workerMessages = fixture.worker.sent.slice(workerStart);
			const workletMessages = fixture.processorPort.sent.slice(workletStart);
			assert.equal(workerMessages.filter((message) => message.type === 'stream-progress').length, progress.length);
			assert.equal(workletMessages.filter((message) => message.type === 'stream-playhead').length, playheads.length);
			assert.equal(workerMessages.filter((message) => message.type === 'stream-complete').length, 1);
			assert.equal(workletMessages.filter((message) => message.type === 'stream-ended').length, 1);
			assert.equal(fixture.worker.server.size, 0);
			assert.equal(handle.state, 'closed');
		}
	} finally {
		fixture.client.dispose();
	}
});

test('a cancelled subscribed stream does not leave reporting enabled when its processor is reconfigured', async () => {
	const fixture = createFixture();
	const source = createImmutablePcmChunks([new Float32Array(3_072)]);
	try {
		const subscribed = fixture.client.open({
			source, outputPort: fixture.clientPort, highWaterMark: 4,
			onProgress: (): void => {}, onPlayhead: (): void => {},
		});
		await subscribed.primed;
		await subscribed.play();
		render(fixture.processor);
		subscribed.cancel();
		await assert.rejects(subscribed.done, { name: 'AbortError' });
		const workerStart = fixture.worker.sent.length;
		const workletStart = fixture.processorPort.sent.length;
		const replacement = fixture.client.open({ source, outputPort: fixture.clientPort, highWaterMark: 4 });
		await replacement.primed;
		await replacement.play();
		for (let block = 0; block < 24; block += 1) render(fixture.processor);
		await replacement.done;
		assert.equal(fixture.worker.sent.slice(workerStart).some((message) => message.type === 'stream-progress'), false);
		assert.equal(fixture.processorPort.sent.slice(workletStart).some((message) => message.type === 'stream-playhead'), false);
	} finally {
		fixture.client.dispose();
	}
});

test('direct worker protocol leaves progress off by default while preserving demand, backpressure and source errors', () => {
	const worker = new LinkedWorker();
	worker.postMessage({
		type: 'open-stream', streamId: 'unobserved',
		source: { channelCount: 1, frameCount: 2_048, chunkFrames: 2_048 }, highWaterMark: 1,
	});
	worker.postMessage({ type: 'start-stream', streamId: 'unobserved' });
	const request = worker.sent.find((message) => message.type === 'need-storage-chunk');
	assert.ok(request);
	worker.postMessage({
		type: 'storage-chunk', streamId: 'unobserved',
		requestId: request.requestId, chunkIndex: request.chunkIndex, channels: [new Float32Array(2_048)],
	});
	const first = worker.sent.find((message) => message.type === 'audio-packet');
	assert.ok(first);
	assert.equal(worker.sent.filter((message) => message.type === 'audio-packet').length, 1);
	assert.equal(worker.sent.some((message) => message.type === 'stream-progress'), false);
	worker.postMessage({ type: 'packet-consumed', streamId: 'unobserved', packetId: first.packetId });
	const second = worker.sent.filter((message) => message.type === 'audio-packet').at(-1);
	assert.ok(second);
	assert.equal(worker.sent.some((message) => message.type === 'source-ended'), true);
	worker.postMessage({ type: 'packet-consumed', streamId: 'unobserved', packetId: second.packetId });
	assert.equal(worker.sent.at(-1)?.type, 'stream-complete');
	worker.postMessage({
		type: 'open-stream', streamId: 'failed-source',
		source: { channelCount: 1, frameCount: 128, chunkFrames: 128 },
	});
	worker.postMessage({ type: 'start-stream', streamId: 'failed-source' });
	worker.postMessage({ type: 'storage-error', streamId: 'failed-source', message: 'Storage unavailable' });
	assert.equal(worker.sent.at(-1)?.type, 'stream-error');
	assert.equal(worker.server.size, 0);
	worker.terminate();
});

test('direct worklet protocol leaves playhead reporting off by default and keeps underrun and end reports', () => {
	const port = new LinkedPort();
	const processor = new ChunkStreamPlaybackProcessor({ processorOptions: { messagePort: port, channelCount: 1 } });
	port.dispatch({ type: 'configure-stream', streamId: 'unobserved', channelCount: 1, startFrame: 0, endFrame: 2_048 });
	port.dispatch({ type: 'play-stream', streamId: 'unobserved' });
	for (let block = 0; block < 16; block += 1) render(processor);
	assert.equal(port.sent.some((message) => message.type === 'stream-playhead'), false);
	assert.equal(port.sent.some((message) => message.type === 'stream-underrun'), true);
	assert.equal(port.sent.at(-1)?.type, 'stream-ended');
	port.dispatch({ type: 'configure-stream', streamId: 'invalid', channelCount: 1, startFrame: 0, endFrame: 0 });
	assert.equal(port.sent.at(-1)?.type, 'stream-error');
});

function render(processor: ChunkStreamPlaybackProcessor): Float32Array {
	const output = new Float32Array(128);
	processor.process([], [[output]]);
	return output;
}

function createFixture() {
	const worker = new LinkedWorker();
	const [clientPort, processorPort] = createPortPair();
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: processorPort, channelCount: 1, prebufferPackets: 1 },
	});
	const client = new ChunkStreamClient({
		workerFactory: () => worker,
		messageChannelFactory: () => {
			const [port1, port2] = createPortPair();
			return { port1, port2 };
		},
	});
	return { worker, client, processor, clientPort, processorPort };
}

function createPortPair(): [LinkedPort, LinkedPort] {
	const left = new LinkedPort();
	const right = new LinkedPort();
	left.peer = right;
	right.peer = left;
	return [left, right];
}

class LinkedPort {
	peer: LinkedPort | null = null;
	onmessage: MessageListener | null = null;
	readonly sent: StreamMessage[] = [];
	readonly listeners = new Set<MessageListener>();
	start(): void {}
	close(): void {}
	addEventListener(type: string, listener: MessageListener): void { if (type === 'message') this.listeners.add(listener); }
	removeEventListener(type: string, listener: MessageListener): void { if (type === 'message') this.listeners.delete(listener); }
	postMessage(message: StreamMessage): void {
		this.sent.push(message);
		this.peer?.dispatch(message);
	}
	dispatch(data: StreamMessage): void {
		this.onmessage?.({ data });
		for (const listener of this.listeners) listener({ data });
	}
}

class LinkedWorker {
	readonly sent: StreamMessage[] = [];
	readonly listeners = new Set<MessageListener>();
	readonly inbound = new Set<MessageListener>();
	readonly server: ReturnType<typeof installChunkStreamWorker>;
	constructor() {
		const scope = {
			addEventListener: (_type: string, listener: MessageListener): void => { this.inbound.add(listener); },
			removeEventListener: (_type: string, listener: MessageListener): void => { this.inbound.delete(listener); },
			postMessage: (message: StreamMessage): void => {
				this.sent.push(message);
				for (const listener of this.listeners) listener({ data: message });
			},
		};
		this.server = installChunkStreamWorker(scope as unknown as typeof globalThis);
	}
	addEventListener(type: string, listener: MessageListener): void { if (type === 'message') this.listeners.add(listener); }
	postMessage(data: StreamMessage): void { for (const listener of this.inbound) listener({ data }); }
	terminate(): void { this.server.dispose(); }
}
