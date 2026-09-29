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

test('a late play message skips source frames while preserving packet order and acknowledgments', () => {
	const previousCurrentFrame = globalThis.currentFrame;
	const port = new FakePort();
	const processor = new ChunkStreamPlaybackProcessor({ processorOptions: { messagePort: port, channelCount: 1, prebufferPackets: 1 } });
	try {
		port.dispatch({ type: 'configure-stream', streamId: 'late-play', channelCount: 1,
			startFrame: 0, endFrame: 2_048, packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES });
		for (let index = 0; index < 2; index += 1) port.dispatch({ type: 'audio-packet', streamId: 'late-play',
			packetId: `packet-${index}`, frameStart: index * 1_024,
			channels: [Float32Array.from({ length: 1_024 }, (_, frame) => index * 1_024 + frame + 1)] });
		for (let block = 0; block < 9; block += 1) {
			globalThis.currentFrame = block * 128;
			const silent = [new Float32Array(128)];
			processor.process([], [silent]);
			assert.ok(silent[0].every((sample) => sample === 0));
		}
		port.dispatch({ type: 'play-stream', streamId: 'late-play', contextStartFrame: 0 });
		globalThis.currentFrame = 1_152;
		const first = [new Float32Array(128)];
		processor.process([], [first]);
		assert.equal(first[0][0], 1_153);
		assert.equal(first[0][127], 1_280);
		for (let frame = 1_280; frame < 2_048; frame += 128) {
			globalThis.currentFrame = frame;
			processor.process([], [[new Float32Array(128)]]);
		}
		assert.deepEqual(consumed(port), [
			{ packetId: 'packet-0', status: 'dropped-late' },
			{ packetId: 'packet-1', status: 'consumed' },
		]);
		assert.equal(port.messages.some((message) => message.type === 'stream-ended'), true);
	} finally {
		if (previousCurrentFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousCurrentFrame;
	}
});

test('a late play message retains the fractional quantum start offset', () => {
	const previousCurrentFrame = globalThis.currentFrame;
	const port = new FakePort();
	const processor = new ChunkStreamPlaybackProcessor({ processorOptions: { messagePort: port, channelCount: 1, prebufferPackets: 1 } });
	try {
		port.dispatch({ type: 'configure-stream', streamId: 'late-mid-quantum', channelCount: 1,
			startFrame: 0, endFrame: 1_024, packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES });
		port.dispatch({ type: 'audio-packet', streamId: 'late-mid-quantum', packetId: 'ramp', frameStart: 0,
			channels: [Float32Array.from({ length: 1_024 }, (_, frame) => frame + 1)] });
		globalThis.currentFrame = 128;
		port.dispatch({ type: 'play-stream', streamId: 'late-mid-quantum', contextStartFrame: 64 });
		const output = [new Float32Array(128)];
		processor.process([], [output]);
		assert.equal(output[0][0], 65);
		assert.equal(output[0][127], 192);
	} finally {
		if (previousCurrentFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousCurrentFrame;
	}
});

test('a late resume advances from the paused source frame', () => {
	const previousCurrentFrame = globalThis.currentFrame;
	const port = new FakePort();
	const processor = new ChunkStreamPlaybackProcessor({ processorOptions: { messagePort: port, channelCount: 1, prebufferPackets: 1 } });
	try {
		port.dispatch({ type: 'configure-stream', streamId: 'late-resume', channelCount: 1,
			startFrame: 0, endFrame: 1_024, packetFrames: AUDIO_EDITOR_TRANSFER_CHUNK_FRAMES });
		port.dispatch({ type: 'audio-packet', streamId: 'late-resume', packetId: 'ramp', frameStart: 0,
			channels: [Float32Array.from({ length: 1_024 }, (_, frame) => frame + 1)] });
		port.dispatch({ type: 'play-stream', streamId: 'late-resume', contextStartFrame: 0 });
		for (let frame = 0; frame < 512; frame += 128) {
			globalThis.currentFrame = frame;
			processor.process([], [[new Float32Array(128)]]);
		}
		port.dispatch({ type: 'pause-stream', streamId: 'late-resume' });
		for (let frame = 512; frame < 896; frame += 128) {
			globalThis.currentFrame = frame;
			const silent = [new Float32Array(128)];
			processor.process([], [silent]);
			assert.ok(silent[0].every((sample) => sample === 0));
		}
		port.dispatch({ type: 'play-stream', streamId: 'late-resume', contextStartFrame: 800 });
		globalThis.currentFrame = 896;
		const resumed = [new Float32Array(128)];
		processor.process([], [resumed]);
		assert.equal(resumed[0][0], 609);
		assert.equal(resumed[0][127], 736);
	} finally {
		if (previousCurrentFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousCurrentFrame;
	}
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
