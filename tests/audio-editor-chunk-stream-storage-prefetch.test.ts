/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIO_EDITOR_STORAGE_CHUNK_FRAMES } from '../src/common/editor/chunk-stream.js';
import { ChunkStreamPlaybackProcessor } from '../src/common/editor/chunk-stream-worklet.js';
import { installChunkStreamWorker } from '../src/common/editor/chunk-stream-worker.js';

interface StreamMessage {
	readonly type: string;
	readonly [key: string]: unknown;
}
type MessageListener = (event: { readonly data: StreamMessage }) => void;

for (const resample of [false, true]) {
	test(`stored playback crosses a chunk boundary during a main-thread repaint${resample ? ' with resampling' : ''}`, () => {
		const fixture = createFixture({ resample });
		try {
			fixture.serviceMainThread();
			fixture.play();
			const firstChunkOutputFrames = AUDIO_EDITOR_STORAGE_CHUNK_FRAMES * (resample ? 44_100 / 48_000 : 1);
			const beforeRepaint = Math.floor((firstChunkOutputFrames - 10_240) / 128) * 128;
			for (let frame = 0; frame < beforeRepaint; frame += 128) {
				assert.ok(fixture.render().every((sample) => Math.abs(sample - 0.5) < 1e-4));
				fixture.serviceMainThread();
			}
			// Worker/worklet packet messages continue, but main-thread storage replies
			// cannot run during the viewport repaint (16,384 frames, or 341–372 ms).
			for (let frame = 0; frame < 16_384; frame += 128) {
				assert.ok(fixture.render().every((sample) => Math.abs(sample - 0.5) < 1e-4),
					`Audio must keep playing while storage replies are delayed, at frame ${beforeRepaint + frame}.`);
			}
			assert.equal(fixture.control.sent.some((message) => message.type === 'stream-underrun'), false);
		} finally {
			fixture.server.dispose();
		}
	});
}

for (const resample of [false, true]) {
	test(`storage lookahead retains only the next required chunk${resample ? ' when resampling' : ''}`, () => {
		const fixture = createFixture({ resample });
		try {
			fixture.serviceMainThread();
			assert.deepEqual(fixture.storageRequests().map((request) => request.chunkIndex), [0, 1]);
			assert.equal(fixture.packets.sent.filter((message) => message.type === 'audio-packet').length, 8,
				'prefetch does not increase the worklet packet queue');
			fixture.play();
			for (let frame = 0; frame < 1_024; frame += 128) fixture.render();
			fixture.serviceMainThread();
			assert.deepEqual(fixture.storageRequests().map((request) => request.chunkIndex), [0, 1],
				'the remaining source is not read eagerly');
		} finally {
			fixture.server.dispose();
		}
	});
}

test('storage lookahead stops at the selected source range', () => {
	const fixture = createFixture({ sourceEndFrame: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES });
	try {
		fixture.serviceMainThread();
		assert.deepEqual(fixture.storageRequests().map((request) => request.chunkIndex), [0]);
	} finally {
		fixture.server.dispose();
	}
});

test('cancelling during a lookahead read closes the packet channel and ignores its eventual reply', () => {
	const fixture = createFixture();
	try {
		fixture.serviceMainThread(1);
		const request = fixture.storageRequests()[1]!;
		fixture.server.cancel('lookahead', 'stopped');
		assert.equal(fixture.server.size, 0);
		assert.equal(fixture.packets.onmessage, null);
		const messageCount = fixture.messages.length;
		fixture.dispatch({ type: 'storage-chunk', streamId: 'lookahead', requestId: request.requestId,
			chunkIndex: request.chunkIndex, channels: [new Float32Array(Number(request.frames))] });
		assert.equal(fixture.messages.length, messageCount);
		assert.equal(fixture.messages.at(-1)?.type, 'stream-cancelled');
	} finally {
		fixture.server.dispose();
	}
});

for (const reply of ['storage-chunk', 'storage-error']) {
	test(`a late prefetched ${reply} is ignored after resampled production ends`, () => {
		const fixture = createFixture({ resample: true,
			sourceEndFrame: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES + 24, resampleInputFrames: 60_000 });
		try {
			fixture.serviceMainThread(1);
			assert.deepEqual(fixture.storageRequests().map((request) => request.chunkIndex), [0, 1]);
			fixture.play();
			let blocks = 0;
			while (!fixture.packets.sent.some((message) => message.type === 'source-ended') && blocks < 1_000) {
				fixture.render();
				blocks += 1;
			}
			assert.ok(blocks < 1_000, 'the current chunk finishes the resampled output without the lookahead read');
			const request = fixture.storageRequests()[1]!;
			fixture.dispatch({ type: reply, streamId: 'lookahead', requestId: request.requestId,
				chunkIndex: request.chunkIndex, channels: [], message: 'The retired source read failed.' });
			assert.equal(fixture.messages.some((message) => message.type === 'stream-error'), false);
			while (fixture.server.size && blocks < 1_000) { fixture.render(); blocks += 1; }
			assert.equal(fixture.server.size, 0);
			assert.equal(fixture.messages.at(-1)?.type, 'stream-complete');
		} finally {
			fixture.server.dispose();
		}
	});
}

function createFixture({
	resample = false,
	sourceEndFrame = AUDIO_EDITOR_STORAGE_CHUNK_FRAMES * 3,
	resampleInputFrames = sourceEndFrame,
}: Readonly<{ resample?: boolean; sourceEndFrame?: number; resampleInputFrames?: number }> = {}) {
	const messages: StreamMessage[] = [];
	const listeners = new Set<MessageListener>();
	const scope = {
		addEventListener: (_type: string, listener: MessageListener): void => { listeners.add(listener); },
		removeEventListener: (_type: string, listener: MessageListener): void => { listeners.delete(listener); },
		postMessage: (message: StreamMessage): void => { messages.push(message); },
	};
	const dispatch = (data: StreamMessage): void => {
		for (const listener of listeners) listener({ data });
	};
	const server = installChunkStreamWorker(scope as unknown as typeof globalThis);
	const control = new LinkedPort();
	const workletPackets = new LinkedPort();
	const packets = new LinkedPort();
	packets.peer = workletPackets;
	workletPackets.peer = packets;
	const processor = new ChunkStreamPlaybackProcessor({
		processorOptions: { messagePort: control, channelCount: 1, prebufferPackets: 4 },
	});
	const endFrame = resample ? Math.round(resampleInputFrames * 44_100 / 48_000) : sourceEndFrame;
	control.dispatch({ type: 'configure-stream', streamId: 'lookahead', channelCount: 1,
		startFrame: 0, endFrame, highWaterMark: 8 });
	control.dispatch({ type: 'attach-packet-port', streamId: 'lookahead', port: workletPackets });
	dispatch({ type: 'open-stream', streamId: 'lookahead', source: {
		channelCount: 1, frameCount: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES * 4,
		chunkFrames: AUDIO_EDITOR_STORAGE_CHUNK_FRAMES,
	}, startFrame: 0, endFrame, sourceStartFrame: 0, sourceEndFrame, resample,
		...(resample ? { resampleInputFrames } : {}),
		highWaterMark: 8, packetPort: packets });
	dispatch({ type: 'start-stream', streamId: 'lookahead' });
	const serviced = new Set<unknown>();
	const storageRequests = (): StreamMessage[] => messages.filter((message) => message.type === 'need-storage-chunk');
	return {
		server, control, packets, storageRequests, messages, dispatch,
		play(): void { control.dispatch({ type: 'play-stream', streamId: 'lookahead' }); },
		render(): Float32Array {
			const output = new Float32Array(128);
			processor.process([], [[output]]);
			return output;
		},
		serviceMainThread(maximumReplies = Number.POSITIVE_INFINITY): void {
			for (let replies = 0; replies < maximumReplies; replies += 1) {
				const request = storageRequests().find((candidate) => !serviced.has(candidate.requestId));
				if (!request) return;
				serviced.add(request.requestId);
				dispatch({ type: 'storage-chunk', streamId: 'lookahead', requestId: request.requestId,
					chunkIndex: request.chunkIndex,
					channels: [new Float32Array(Number(request.frames)).fill(0.5)] });
			}
		},
	};
}

class LinkedPort {
	peer: LinkedPort | null = null;
	onmessage: MessageListener | null = null;
	readonly sent: StreamMessage[] = [];
	start(): void {}
	close(): void {}
	postMessage(message: StreamMessage): void {
		this.sent.push(message);
		this.peer?.dispatch(message);
	}
	dispatch(data: StreamMessage): void { this.onmessage?.({ data }); }
}
