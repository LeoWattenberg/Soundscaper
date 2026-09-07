import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES } from '../src/common/editor/chunk-stream.js';
import { ChunkStreamPlaybackProcessor } from '../src/common/editor/chunk-stream-worklet.js';

test('worklet acknowledges audio packets delivered after the stream has already ended', () => {
	const port = new FakePort();
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: port, channelCount: 2, prebufferPackets: 1 },
	});
	port.dispatch({
		type: 'configure-stream',
		streamId: 'late-delivery',
		channelCount: 2,
		startFrame: 0,
		endFrame: 2_048,
		packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
	});
	port.dispatch({ type: 'audio-packet', streamId: 'late-delivery', ...packet('one', 0, 0.5) });
	port.dispatch({ type: 'play-stream', streamId: 'late-delivery' });

	// The main thread stalls: the worklet drains its queue and advances the
	// source playhead through silence until it reaches the end of the stream.
	render(processor, 16);
	assert.equal(port.messages.some((message) => message.type === 'stream-underrun'), true);
	assert.equal(port.messages.some((message) => message.type === 'stream-ended'), true);
	assert.deepEqual(consumed(port), [{ packetId: 'one', status: 'consumed' }]);

	// The stall clears and the packets the worker had already emitted arrive.
	port.dispatch({ type: 'audio-packet', streamId: 'late-delivery', ...packet('two', 1_024, 0.25) });
	port.dispatch({ type: 'audio-packet', streamId: 'late-delivery', ...packet('three', 2_048, -0.25) });
	render(processor, 4);

	assert.deepEqual(consumed(port), [
		{ packetId: 'one', status: 'consumed' },
		{ packetId: 'two', status: 'dropped-late' },
		{ packetId: 'three', status: 'dropped-late' },
	]);
	assert.equal(port.messages.some((message) => message.type === 'stream-error'), false);
});

test('worklet acknowledges audio packets delivered after the stream was cancelled', () => {
	const port = new FakePort();
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: port, channelCount: 2, prebufferPackets: 1 },
	});
	port.dispatch({
		type: 'configure-stream',
		streamId: 'cancelled-delivery',
		channelCount: 2,
		startFrame: 0,
		endFrame: 2_048,
		packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES,
	});
	port.dispatch({ type: 'play-stream', streamId: 'cancelled-delivery' });
	render(processor, 1);
	port.dispatch({ type: 'cancel-stream', streamId: 'cancelled-delivery', reason: 'seek' });
	assert.equal(port.messages.some((message) => message.type === 'worklet-cancelled'), true);

	port.dispatch({ type: 'audio-packet', streamId: 'cancelled-delivery', ...packet('stray', 0, 0.5) });

	assert.deepEqual(consumed(port), [{ packetId: 'stray', status: 'dropped-late' }]);
	assert.equal(port.messages.some((message) => message.type === 'stream-error'), false);
});

function render(processor, blocks) {
	for (let block = 0; block < blocks; block += 1) {
		processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
	}
}

function consumed(port) {
	return port.messages
		.filter((message) => message.type === 'packet-consumed')
		.map(({ packetId, status }) => ({ packetId, status }));
}

function packet(packetId, frameStart, value) {
	return {
		packetId,
		frameStart,
		channels: [
			new Float32Array(AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES).fill(value),
			new Float32Array(AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES).fill(value),
		],
	};
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
