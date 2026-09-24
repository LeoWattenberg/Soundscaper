/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES } from '../src/common/editor/chunk-stream.js';
import { ChunkStreamClient } from '../src/common/editor/chunk-stream-client.js';
import { ChunkStreamPlaybackProcessor } from '../src/common/editor/chunk-stream-worklet.js';
import { installChunkStreamWorker } from '../src/common/editor/chunk-stream-worker.js';
import { createImmutablePcmChunks } from '../src/common/editor/pcm-chunks.js';

test('worker releases a transferred direct port when stream admission fails', () => {
	let listener;
	const messages = [];
	const scope = {
		addEventListener(_type, callback) { listener = callback; },
		removeEventListener() {},
		postMessage(message) { messages.push(message); },
	};
	const server = installChunkStreamWorker(scope);
	const packetPort = new FakePort();
	listener({ data: {
		type: 'open-stream', streamId: 'invalid-source',
		source: { channelCount: 0, frameCount: 128, chunkFrames: 128 }, packetPort,
	} });
	assert.equal(packetPort.closed, true);
	assert.equal(server.size, 0);
	assert.equal(messages.at(-1).type, 'stream-error');
	server.dispose();
});

test('worker releases an adopted direct port when ready notification fails', () => {
	let listener;
	const messages = [];
	const scope = {
		addEventListener(_type, callback) { listener = callback; },
		removeEventListener() {},
		postMessage(message) {
			if (message.type === 'stream-ready') throw new Error('ready post failed');
			messages.push(message);
		},
	};
	const server = installChunkStreamWorker(scope);
	const packetPort = new FakePort();
	listener({ data: {
		type: 'open-stream', streamId: 'failed-ready',
		source: { channelCount: 1, frameCount: 128, chunkFrames: 128 }, packetPort,
	} });
	assert.equal(packetPort.closed, true);
	assert.equal(server.size, 0);
	assert.equal(messages.at(-1).type, 'stream-error');
	server.dispose();
});

test('worklet acknowledges packets arriving after playback ends before releasing its direct port', () => {
	const control = new FakePort();
	const direct = new FakePort();
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: control, channelCount: 1, prebufferPackets: 1 },
	});
	control.dispatch({ type: 'configure-stream', streamId: 'late-direct', channelCount: 1,
		startFrame: 0, endFrame: 128, packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES });
	control.dispatch({ type: 'attach-packet-port', streamId: 'late-direct', port: direct });
	direct.dispatch({ type: 'audio-packet', streamId: 'late-direct', packetId: 'first',
		frameStart: 0, channels: [new Float32Array(128).fill(0.5)] });
	control.dispatch({ type: 'play-stream', streamId: 'late-direct' });
	processor.process([], [[new Float32Array(128)]]);
	assert.equal(direct.closed, false);
	direct.dispatch({ type: 'audio-packet', streamId: 'late-direct', packetId: 'late',
		frameStart: 128, channels: [new Float32Array(128)] });
	assert.deepEqual(direct.messages.filter((message) => message.type === 'packet-consumed')
		.map((message) => [message.packetId, message.status]), [
			['first', 'consumed'], ['late', 'dropped-late'],
		]);
	control.dispatch({ type: 'release-packet-port', streamId: 'late-direct' });
	assert.equal(direct.closed, true);
});

test('client bridges immutable storage to the worklet and completes atomically', async () => {
	const worker = createLinkedWorker();
	const [clientPort, processorPort] = createPortPair();
	let packetPorts;
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: processorPort, channelCount: 2, prebufferPackets: 2 },
	});
	const client = new ChunkStreamClient({
		workerFactory: () => worker,
		messageChannelFactory: () => {
			packetPorts = createPortPair();
			return { port1: packetPorts[0], port2: packetPorts[1] };
		},
	});
	const source = createImmutablePcmChunks([
		Float32Array.from({ length: 2_500 }, (_, frame) => frame / 2_500),
		Float32Array.from({ length: 2_500 }, (_, frame) => -frame / 2_500),
	]);
	const progress = [];
	const handle = client.open({
		streamId: 'bridge-test',
		source,
		outputPort: clientPort,
		highWaterMark: 2,
		onProgress: (value) => progress.push(value),
	});
	assert.equal((await handle.ready).channelCount, 2);
	assert.equal((await handle.primed).packets, 2);
	await handle.play();
	const output = [[], []];
	for (let block = 0; block < Math.ceil(2_500 / 128); block += 1) {
		const quantum = [new Float32Array(128), new Float32Array(128)];
		processor.process([], [quantum]);
		output[0].push(...quantum[0]);
		output[1].push(...quantum[1]);
	}
	const result = await handle.done;
	assert.equal(result.frames, 2_500);
	assert.ok(Math.abs(output[0][1_000] - (1_000 / 2_500)) < 1e-6);
	assert.ok(Math.abs(output[1][2_499] - (-2_499 / 2_500)) < 1e-6);
	assert.equal(progress.at(-1).progress, 1);
	assert.equal(handle.state, 'closed');
	assert.ok(packetPorts[1].sent.some((message) => message.type === 'audio-packet'));
	assert.ok(packetPorts[0].sent.some((message) => message.type === 'packet-consumed'));
	assert.equal(worker.sentToMain.some((message) => message.type === 'audio-packet'), false);
	assert.equal(worker.sentToWorker.some((message) => message.type === 'packet-consumed'), false);
	assert.equal(clientPort.sent.some((message) => message.type === 'audio-packet'), false);
	assert.equal(processorPort.sent.some((message) => message.type === 'packet-consumed'), false);
	assert.equal(packetPorts[0].closed, true);
	assert.equal(packetPorts[1].closed, true);
	client.dispose();
});

test('cancelling a direct stream closes both packet endpoints', async () => {
	const worker = createLinkedWorker();
	const [clientPort, processorPort] = createPortPair();
	new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: processorPort, channelCount: 1, prebufferPackets: 1 },
	});
	let packetPorts;
	const client = new ChunkStreamClient({
		workerFactory: () => worker,
		messageChannelFactory: () => {
			packetPorts = createPortPair();
			return { port1: packetPorts[0], port2: packetPorts[1] };
		},
	});
	const source = createImmutablePcmChunks([new Float32Array(2_500).fill(0.5)]);
	const handle = client.open({ source, outputPort: clientPort, highWaterMark: 2 });
	await handle.primed;
	handle.cancel();
	await assert.rejects(handle.done, { name: 'AbortError' });
	assert.equal(packetPorts[0].closed, true);
	assert.equal(packetPorts[1].closed, true);
	client.dispose();
});

test('real MessagePorts deliver late acknowledgments and settle the worker', async () => {
	const worker = createLinkedWorker();
	const control = new MessageChannel();
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: control.port2, channelCount: 1, prebufferPackets: 2 },
	});
	const client = new ChunkStreamClient({ workerFactory: () => worker });
	try {
		const source = createImmutablePcmChunks([
			Float32Array.from({ length: 2_500 }, (_, frame) => frame / 2_500),
		]);
		const handle = client.open({ source, outputPort: control.port1, highWaterMark: 3 });
		await handle.primed;
		await handle.play();
		let blocks = 0;
		while (!processor.ended && blocks < 100) {
			processor.process([], [[new Float32Array(128)]]);
			blocks += 1;
			await new Promise((resolve) => setImmediate(resolve));
		}
		assert.equal(processor.ended, true);
		assert.equal((await handle.done).frames, 2_500);
		assert.equal(worker.sentToMain.some((message) => message.type === 'audio-packet'), false);
		assert.equal(worker.sentToWorker.some((message) => message.type === 'packet-consumed'), false);
	} finally {
		client.dispose();
		control.port1.close();
		control.port2.close();
	}
});

class FakePort {
	constructor() {
		this.onmessage = null;
		this.messages = [];
		this.closed = false;
	}

	start() {}
	close() { this.closed = true; }
	postMessage(message) { this.messages.push(message); }
	dispatch(data) { this.onmessage?.({ data }); }
}

function createPortPair() {
	const left = createEventPort();
	const right = createEventPort();
	left.peer = right;
	right.peer = left;
	return [left, right];
}

function createEventPort() {
	return {
		peer: null,
		sent: [],
		closed: false,
		listeners: new Set(),
		onmessage: null,
		close() { this.closed = true; },
		addEventListener(type, listener) { if (type === 'message') this.listeners.add(listener); },
		removeEventListener(type, listener) { if (type === 'message') this.listeners.delete(listener); },
		start() {},
		postMessage(message) {
			this.sent.push(message);
			const event = { data: message };
			this.peer?.onmessage?.(event);
			for (const listener of this.peer?.listeners || []) listener(event);
		},
	};
}

function createLinkedWorker() {
	const sentToMain = [];
	const sentToWorker = [];
	const workerListeners = new Map([
		['message', new Set()], ['error', new Set()], ['messageerror', new Set()],
	]);
	const scopeListeners = new Set();
	const scope = {
		addEventListener(type, listener) { if (type === 'message') scopeListeners.add(listener); },
		removeEventListener(type, listener) { if (type === 'message') scopeListeners.delete(listener); },
		postMessage(message) {
			sentToMain.push(message);
			for (const listener of workerListeners.get('message')) listener({ data: message });
		},
	};
	const server = installChunkStreamWorker(scope);
	return {
		sentToMain,
		sentToWorker,
		addEventListener(type, listener) { workerListeners.get(type)?.add(listener); },
		postMessage(message) {
			sentToWorker.push(message);
			for (const listener of scopeListeners) listener({ data: message });
		},
		terminate() { server.dispose(); },
	};
}
