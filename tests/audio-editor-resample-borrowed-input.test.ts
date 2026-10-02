/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { installChunkStreamWorker } from '../src/common/editor/chunk-stream-worker.js';
import { createOfflineChunkResampleBuffer } from '../src/common/editor/engine/offline-chunk-resample.ts';
import { createStreamingWindowedSincResampler } from '../src/common/editor/resample.js';

interface StreamMessage {
	readonly type: string;
	readonly [field: string]: unknown;
}

function fixture(context: TestContext) {
	const channels = Array.from({ length: 2 }, (_, channel) => Float32Array.from(
		{ length: 8_192 }, (_, frame) => Math.sin(frame * 0.13 + channel) * 0.8,
	));
	let copiedBytes = 0;
	for (const channel of channels) {
		const original = channel.slice;
		context.mock.method(channel, 'slice', (start?: number, end?: number) => {
			const result = original.call(channel, start, end);
			copiedBytes += result.byteLength;
			return result;
		});
	}
	const resampler = createStreamingWindowedSincResampler(8_192, 4_096, 2) as {
		push(input: readonly Float32Array[]): readonly Float32Array[];
		finish(): readonly Float32Array[];
	};
	const first = resampler.push(channels);
	const last = resampler.finish();
	const expected = first.map((channel, index) => Float32Array.from([...channel, ...last[index]!]));
	return { channels, expected, copiedBytes: () => copiedBytes };
}

test('offline resampling borrows PCM input while retaining exact output and progress', async (context) => {
	const source = fixture(context);
	const output = source.channels.map(() => new Float32Array(4_096));
	let admittedFrames = 0;
	const buffer = await createOfflineChunkResampleBuffer({
		context: {
			sampleRate: 48_000,
			createBuffer: () => ({ getChannelData: (channel: number) => output[channel]! }),
		} as unknown as BaseAudioContext,
		source: {
			channelCount: 2, frameCount: 8_192, sampleRate: 48_000, chunkFrames: 8_192,
			readStorageChunk: () => source.channels,
		},
		inputOffsetFrame: 0, inputFrameCount: 8_192, outputFrameCount: 4_096,
		onInputFrames: (frames) => { admittedFrames += frames; },
	});
	assert.deepEqual(output, source.expected);
	assert.equal(buffer.getChannelData(0), output[0]);
	assert.equal(admittedFrames, 8_192);
	assert.equal(source.copiedBytes(), 0, 'the resampler copies borrowed input before retaining its history');
});

test('live resampling borrows storage PCM and gives playback packets their own buffers', (context) => {
	const source = fixture(context);
	const sent: StreamMessage[] = [];
	let dispatch: (message: StreamMessage) => void = () => undefined;
	const server = installChunkStreamWorker({
		addEventListener: (_type: string, listener: (event: { data: StreamMessage }) => void) => {
			dispatch = (data) => listener({ data });
		},
		postMessage: (message: StreamMessage) => { sent.push(message); },
	} as unknown as typeof globalThis);
	try {
		dispatch({
			type: 'open-stream', streamId: 'borrowed', highWaterMark: 8, resample: true,
			source: { channelCount: 2, frameCount: 8_192, chunkFrames: 8_192 },
			startFrame: 0, endFrame: 4_096, sourceStartFrame: 0, sourceEndFrame: 8_192,
		});
		dispatch({ type: 'start-stream', streamId: 'borrowed' });
		const request = sent.find((message) => message.type === 'need-storage-chunk');
		assert.ok(request);
		dispatch({
			type: 'storage-chunk', streamId: 'borrowed', requestId: request.requestId,
			chunkIndex: 0, channels: source.channels,
		});
		assert.equal(sent.some((message) => message.type === 'stream-error'), false);
		const packets = sent.filter((message) => message.type === 'audio-packet');
		assert.equal(packets.length, 5);
		for (let channel = 0; channel < source.channels.length; channel++) {
			const collected: number[] = [];
			for (const packet of packets) {
				const pcm = (packet.channels as Float32Array[])[channel]!;
				assert.notEqual(pcm.buffer, source.channels[channel]!.buffer);
				collected.push(...pcm);
			}
			assert.deepEqual(Float32Array.from(collected), source.expected[channel]);
		}
		assert.equal(source.copiedBytes(), 0);
	} finally {
		server.dispose();
	}
});
