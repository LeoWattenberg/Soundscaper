import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
	AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
} from '../src/common/editor/chunk-stream.js';
import { createImmutablePcmStreamSource } from '../src/common/editor/chunk-stream-client.js';
import { installChunkStreamWorker } from '../src/common/editor/chunk-stream-worker.js';

test('long-source descriptors accept bounded legacy recording chunk sizes', () => {
	const source = createImmutablePcmStreamSource({
		channelCount: 1,
		frameCount: 10_000,
		chunkFrames: 4_096,
		async readStorageChunk() { return [new Float32Array(4_096)]; },
	});
	assert.equal(source.chunkFrames, 4_096);
	assert.throws(() => createImmutablePcmStreamSource({
		channelCount: 1,
		frameCount: 10_000,
		chunkFrames: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES + 1,
		async readStorageChunk() { return [new Float32Array(1)]; },
	}), /source\.chunkFrames/);
});

test('chunk-stream worker traverses variable-size storage chunks under packet backpressure', () => {
	const scope = new FakeWorkerScope();
	const server = installChunkStreamWorker(scope);
	scope.dispatch({
		type: 'open-stream',
		streamId: 'legacy-recording',
		source: { channelCount: 1, frameCount: 10_000, chunkFrames: 4_096 },
		startFrame: 0,
		endFrame: 10_000,
		packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
		highWaterMark: 2,
	});
	scope.dispatch({ type: 'start-stream', streamId: 'legacy-recording' });

	const fulfilledRequests = new Set();
	const acknowledgedPackets = new Set();
	while (server.size) {
		const request = scope.messages.find(({ message }) => (
			message.type === 'need-storage-chunk' && !fulfilledRequests.has(message.requestId)
		));
		if (request) {
			fulfilledRequests.add(request.message.requestId);
			const { chunkIndex, frames, requestId } = request.message;
			scope.dispatch({
				type: 'storage-chunk',
				streamId: 'legacy-recording',
				requestId,
				chunkIndex,
				channels: [new Float32Array(frames).fill(chunkIndex + 1)],
			});
			continue;
		}
		const packet = scope.messages.find(({ message }) => (
			message.type === 'audio-packet' && !acknowledgedPackets.has(message.packetId)
		));
		assert.ok(packet, 'a storage request or packet remains available while the stream is active');
		acknowledgedPackets.add(packet.message.packetId);
		scope.dispatch({
			type: 'packet-consumed',
			streamId: 'legacy-recording',
			packetId: packet.message.packetId,
		});
	}

	const requests = scope.messages
		.filter(({ message }) => message.type === 'need-storage-chunk')
		.map(({ message }) => ({ index: message.chunkIndex, start: message.frameStart, frames: message.frames }));
	assert.deepEqual(requests, [
		{ index: 0, start: 0, frames: 4_096 },
		{ index: 1, start: 4_096, frames: 4_096 },
		{ index: 2, start: 8_192, frames: 1_808 },
	]);
	const packets = scope.messages.filter(({ message }) => message.type === 'audio-packet');
	assert.equal(packets.reduce((total, { message }) => total + message.frames, 0), 10_000);
	assert.ok(packets.every(({ message }) => message.frames <= AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES));
	assert.equal(scope.messages.at(-1).message.type, 'stream-complete');
	server.dispose();
});

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
