import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
	AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
	TransferableAudioChunkQueue,
	transferListForAudioChannels,
} from '../src/lib/tools/audio-editor/chunk-stream.js';
import {
	ChunkStreamClient,
} from '../src/lib/tools/audio-editor/chunk-stream-client.js';
import {
	ChunkStreamPlaybackProcessor,
} from '../src/lib/tools/audio-editor/chunk-stream-worklet.js';
import { installChunkStreamWorker } from '../src/lib/tools/audio-editor/chunk-stream-worker.js';
import { createImmutablePcmChunks } from '../src/lib/tools/audio-editor/pcm-chunks.js';
import { createStreamingWindowedSincResampler } from '../src/lib/tools/audio-editor/resample.js';

test('transferable queue is bounded, contiguous, and rejects shared memory', () => {
	const queue = new TransferableAudioChunkQueue({ channelCount: 2, capacity: 2, startFrame: 0 });
	const first = packet('first', 0, 1, 2);
	const second = packet('second', AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES, 3, 4);
	queue.enqueue(first);
	queue.enqueue(second);
	assert.equal(queue.full, true);
	assert.equal(queue.queuedFrames, AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES * 2);
	assert.throws(() => queue.enqueue(packet('third', 2_048, 5, 6)), { code: 'QUEUE_FULL' });
	assert.equal(queue.dequeue().packetId, 'first');
	assert.equal(queue.queuedFrames, AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES);
	assert.equal(queue.dequeue().packetId, 'second');

	const discontinuous = new TransferableAudioChunkQueue({ channelCount: 1, startFrame: 100 });
	assert.throws(() => discontinuous.enqueue({
		packetId: 1,
		frameStart: 101,
		channels: [new Float32Array(1)],
	}), { code: 'NON_CONTIGUOUS_PACKET' });

	const sharedBuffer = new ArrayBuffer(8 * Float32Array.BYTES_PER_ELEMENT);
	const sharedViews = [new Float32Array(sharedBuffer, 0, 4), new Float32Array(sharedBuffer, 16, 4)];
	assert.deepEqual(transferListForAudioChannels(sharedViews), [sharedBuffer]);
	if (typeof SharedArrayBuffer === 'function') {
		assert.throws(
			() => transferListForAudioChannels([new Float32Array(new SharedArrayBuffer(16))]),
			{ code: 'SHARED_MEMORY_FORBIDDEN' },
		);
	}
});

test('worker demand-loads one 65,536-frame chunk and enforces packet backpressure', () => {
	const scope = new FakeWorkerScope();
	const server = installChunkStreamWorker(scope);
	scope.dispatch({
		type: 'open-stream',
		streamId: 'worker-test',
		source: { channelCount: 2, frameCount: 70_000, chunkFrames: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES },
		startFrame: 0,
		endFrame: 2_500,
		packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
		highWaterMark: 2,
	});
	assert.equal(scope.messages.at(-1).message.type, 'stream-ready');
	scope.dispatch({ type: 'start-stream', streamId: 'worker-test' });
	const request = scope.messages.find(({ message }) => message.type === 'need-storage-chunk').message;
	assert.equal(request.frames, AUDIO_EDITOR_STORAGE_CHUNK_FRAMES);
	const channels = [
		Float32Array.from({ length: request.frames }, (_, frame) => frame),
		Float32Array.from({ length: request.frames }, (_, frame) => -frame),
	];
	scope.dispatch({
		type: 'storage-chunk',
		streamId: 'worker-test',
		requestId: request.requestId,
		chunkIndex: request.chunkIndex,
		channels,
	});
	let packets = scope.messages.filter(({ message }) => message.type === 'audio-packet');
	assert.equal(packets.length, 2);
	assert.deepEqual(packets.map(({ message }) => message.frames), [1_024, 1_024]);
	assert.ok(packets.every(({ transfer }) => transfer.length === 2));
	assert.equal(scope.messages.some(({ message }) => message.type === 'source-ended'), false);

	scope.dispatch({
		type: 'packet-consumed',
		streamId: 'worker-test',
		packetId: packets[0].message.packetId,
	});
	packets = scope.messages.filter(({ message }) => message.type === 'audio-packet');
	assert.equal(packets.length, 3);
	assert.equal(packets[2].message.frames, 452);
	assert.equal(packets[2].message.channels[0][0], 2_048);
	assert.equal(scope.messages.some(({ message }) => message.type === 'source-ended'), true);

	for (const { message } of packets.slice(1)) {
		scope.dispatch({ type: 'packet-consumed', streamId: 'worker-test', packetId: message.packetId });
	}
	assert.equal(scope.messages.at(-1).message.type, 'stream-complete');
	assert.equal(server.size, 0);
	assert.equal(
		scope.messages.filter(({ message }) => message.type === 'need-storage-chunk').length,
		1,
	);
	assert.equal(
		scope.messages.filter(({ message }) => message.type === 'stream-progress').at(-1).message.progress,
		1,
	);
	server.dispose();
});

test('worker windowed-sinc resamples a source range into bounded playback packets', () => {
	const scope = new FakeWorkerScope();
	const server = installChunkStreamWorker(scope);
	scope.dispatch({
		type: 'open-stream',
		streamId: 'resample-test',
		source: { channelCount: 1, frameCount: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES, chunkFrames: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES },
		startFrame: 0,
		endFrame: 1_600,
		sourceStartFrame: 0,
		sourceEndFrame: 4_800,
		resample: true,
		packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
		highWaterMark: 2,
	});
	scope.dispatch({ type: 'start-stream', streamId: 'resample-test' });
	const request = scope.messages.find(({ message }) => message.type === 'need-storage-chunk').message;
	const input = Float32Array.from({ length: request.frames }, (_, frame) => Math.sin(frame * Math.PI / 20));
	scope.dispatch({
		type: 'storage-chunk',
		streamId: 'resample-test',
		requestId: request.requestId,
		chunkIndex: request.chunkIndex,
		channels: [input],
	});
	const acknowledged = new Set();
	while (server.size) {
		const packet = scope.messages.find(({ message }) => (
			message.type === 'audio-packet' && !acknowledged.has(message.packetId)
		));
		assert.ok(packet, 'backpressure releases another resampled packet');
		acknowledged.add(packet.message.packetId);
		scope.dispatch({ type: 'packet-consumed', streamId: 'resample-test', packetId: packet.message.packetId });
	}
	const packets = scope.messages.filter(({ message }) => message.type === 'audio-packet').map(({ message }) => message);
	assert.equal(packets.reduce((frames, packet) => frames + packet.frames, 0), 1_600);
	let expectedStart = 0;
	for (const packet of packets) {
		assert.equal(packet.frameStart, expectedStart);
		expectedStart += packet.frames;
	}
	assert.ok(packets.every((packet) => packet.frames <= AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES));
	assert.equal(scope.messages.filter(({ message }) => message.type === 'need-storage-chunk').length, 1);
	assert.equal(scope.messages.filter(({ message }) => message.type === 'stream-progress').at(-1).message.progress, 1);
	server.dispose();
});

test('worker windowed-sinc preserves a fractional seek phase with physical pre-roll', () => {
	const scope = new FakeWorkerScope();
	const server = installChunkStreamWorker(scope);
	scope.dispatch({
		type: 'open-stream',
		streamId: 'fractional-resample-test',
		source: { channelCount: 1, frameCount: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES, chunkFrames: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES },
		startFrame: 0,
		endFrame: 8,
		sourceStartFrame: 0,
		sourceEndFrame: 64,
		resampleInputFrames: 8,
		resampleInputOffset: 10.5,
		resample: true,
		packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
		highWaterMark: 1,
	});
	scope.dispatch({ type: 'start-stream', streamId: 'fractional-resample-test' });
	const request = scope.messages.find(({ message }) => message.type === 'need-storage-chunk').message;
	const input = Float32Array.from({ length: request.frames }, (_, frame) => frame);
	scope.dispatch({
		type: 'storage-chunk',
		streamId: 'fractional-resample-test',
		requestId: request.requestId,
		chunkIndex: request.chunkIndex,
		channels: [input],
	});
	const packet = scope.messages.find(({ message }) => message.type === 'audio-packet').message;
	const reference = createStreamingWindowedSincResampler(8, 8, 1, { initialInputPosition: 10.5 })
		.push([input.subarray(0, 64)])[0];
	assert.equal(packet.frames, 8);
	assert.deepEqual([...packet.channels[0]], [...reference.subarray(0, 8)]);
	scope.dispatch({ type: 'packet-consumed', streamId: 'fractional-resample-test', packetId: packet.packetId });
	assert.equal(server.size, 0);
	server.dispose();
});

test('worklet consumes planar packets without allocation and reports underruns', () => {
	const port = new FakePort();
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: port, channelCount: 2, prebufferPackets: 1 },
	});
	port.dispatch({
		type: 'configure-stream',
		streamId: 'worklet-test',
		channelCount: 2,
		startFrame: 0,
		endFrame: 2_048,
		packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
	});
	port.dispatch({
		type: 'audio-packet',
		streamId: 'worklet-test',
		...packet('one', 0, 0.25, -0.5),
	});
	assert.equal(port.messages.some((message) => message.type === 'stream-primed'), true);
	port.dispatch({ type: 'play-stream', streamId: 'worklet-test' });

	const rendered = [[], []];
	for (let block = 0; block < 9; block += 1) {
		const output = [new Float32Array(128), new Float32Array(128)];
		processor.process([], [output]);
		rendered[0].push(...output[0]);
		rendered[1].push(...output[1]);
	}
	assert.equal(rendered[0][0], 0.25);
	assert.equal(rendered[1][1_023], -0.5);
	assert.equal(rendered[0][1_024], 0);
	assert.equal(port.messages.some((message) => message.type === 'stream-underrun'), true);

	port.dispatch({
		type: 'audio-packet',
		streamId: 'worklet-test',
		...packet('two', 1_024, 0.75, -0.75),
	});
	port.dispatch({ type: 'source-ended', streamId: 'worklet-test', endFrame: 2_048 });
	const resumed = [new Float32Array(128), new Float32Array(128)];
	processor.process([], [resumed]);
	assert.equal(resumed[0][0], 0.75);
	for (let block = 0; block < 6; block += 1) {
		processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
	}
	assert.equal(port.messages.some((message) => message.type === 'stream-ended'), true);
	assert.deepEqual(
		port.messages.filter((message) => message.type === 'packet-consumed').map((message) => message.packetId),
		['one', 'two'],
	);
});

test('worklet sample-aligns a streamed clip to its AudioContext start frame', () => {
	const previousCurrentFrame = globalThis.currentFrame;
	const port = new FakePort();
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: port, channelCount: 1, prebufferPackets: 1 },
	});
	try {
		port.dispatch({
			type: 'configure-stream',
			streamId: 'scheduled-stream',
			channelCount: 1,
			startFrame: 0,
			endFrame: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
			packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
		});
		port.dispatch({
			type: 'audio-packet',
			streamId: 'scheduled-stream',
			packetId: 'scheduled-packet',
			frameStart: 0,
			channels: [new Float32Array(AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES).fill(0.5)],
		});
		port.dispatch({ type: 'play-stream', streamId: 'scheduled-stream', contextStartFrame: 64 });
		globalThis.currentFrame = 0;
		const output = [new Float32Array(128)];
		processor.process([], [output]);
		assert.ok(output[0].subarray(0, 64).every((sample) => sample === 0));
		assert.ok(output[0].subarray(64).every((sample) => sample === 0.5));
	} finally {
		if (previousCurrentFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousCurrentFrame;
	}
});

test('client bridges immutable storage to the worklet and completes atomically', async () => {
	const worker = createLinkedWorker();
	const [clientPort, processorPort] = createPortPair();
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: processorPort, channelCount: 2, prebufferPackets: 2 },
	});
	const client = new ChunkStreamClient({ workerFactory: () => worker });
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
	client.dispose();
});

test('client cancellation aborts a pending storage read and rejects completion', async () => {
	const worker = createLinkedWorker();
	const [clientPort, processorPort] = createPortPair();
	new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: processorPort, channelCount: 1, prebufferPackets: 1 },
	});
	let providerSignal;
	const source = {
		channelCount: 1,
		frameCount: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
		chunkFrames: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
		readStorageChunk(_index, context) {
			providerSignal = context.signal;
			return new Promise(() => {});
		},
	};
	const controller = new AbortController();
	const client = new ChunkStreamClient({ workerFactory: () => worker });
	const handle = client.open({ source, outputPort: clientPort, signal: controller.signal });
	await handle.ready;
	controller.abort();
	await assert.rejects(handle.primed, { name: 'AbortError' });
	await assert.rejects(handle.done, { name: 'AbortError' });
	assert.equal(providerSignal.aborted, true);
	assert.equal(handle.state, 'closed');
	client.dispose();
});

function packet(packetId, frameStart, left, right = left) {
	return {
		packetId,
		frameStart,
		channels: [
			new Float32Array(AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES).fill(left),
			new Float32Array(AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES).fill(right),
		],
	};
}

class FakeWorkerScope {
	constructor() {
		this.listeners = new Set();
		this.messages = [];
	}

	addEventListener(type, listener) {
		if (type === 'message') this.listeners.add(listener);
	}

	removeEventListener(type, listener) {
		if (type === 'message') this.listeners.delete(listener);
	}

	postMessage(message, transfer = []) {
		this.messages.push({ message, transfer });
	}

	dispatch(data) {
		for (const listener of this.listeners) listener({ data });
	}
}

class FakePort {
	constructor() {
		this.onmessage = null;
		this.messages = [];
	}

	start() {}

	postMessage(message) {
		this.messages.push(message);
	}

	dispatch(data) {
		this.onmessage?.({ data });
	}
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
		listeners: new Set(),
		onmessage: null,
		addEventListener(type, listener) {
			if (type === 'message') this.listeners.add(listener);
		},
		removeEventListener(type, listener) {
			if (type === 'message') this.listeners.delete(listener);
		},
		start() {},
		postMessage(message) {
			const event = { data: message };
			this.peer?.onmessage?.(event);
			for (const listener of this.peer?.listeners || []) listener(event);
		},
	};
}

function createLinkedWorker() {
	const workerListeners = new Map([
		['message', new Set()],
		['error', new Set()],
		['messageerror', new Set()],
	]);
	const scopeListeners = new Set();
	const scope = {
		addEventListener(type, listener) {
			if (type === 'message') scopeListeners.add(listener);
		},
		removeEventListener(type, listener) {
			if (type === 'message') scopeListeners.delete(listener);
		},
		postMessage(message) {
			for (const listener of workerListeners.get('message')) listener({ data: message });
		},
	};
	const server = installChunkStreamWorker(scope);
	return {
		addEventListener(type, listener) {
			workerListeners.get(type)?.add(listener);
		},
		postMessage(message) {
			for (const listener of scopeListeners) listener({ data: message });
		},
		terminate() {
			server.dispose();
		},
	};
}
