/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { RenderCaptureProcessor } from '../src/common/editor/render-capture-worklet.js';

interface WorkletMessage {
	readonly type?: string;
	readonly code?: string;
	readonly frames?: number;
	readonly channels?: readonly Float32Array[];
}

test('realtime capture worklet fails closed before posting PCM without a producer credit', () => {
	withCurrentFrame(() => {
		const processor = new RenderCaptureProcessor({
			processorOptions: {
				startFrame: 0,
				totalFrames: 256,
				chunkFrames: 128,
				channelCount: 32,
				maximumInFlightChunks: 1,
			},
		});
		const messages = captureMessages(processor);
		assert.equal(processor.process(inputBlock(32), outputBlock(32)), true);
		setCurrentFrame(128);
		assert.equal(processor.process(inputBlock(32), outputBlock(32)), false);
		assert.equal(messages.filter(({ type }) => type === 'audio-chunk').length, 1);
		assert.deepEqual(messages.at(-1), {
			type: 'capture-error',
			code: 'REALTIME_CAPTURE_BACKPRESSURE',
		});
	});
});

test('realtime capture worklet replenishes one credit only after acknowledgement', () => {
	withCurrentFrame(() => {
		const processor = new RenderCaptureProcessor({
			processorOptions: {
				startFrame: 0,
				totalFrames: 256,
				chunkFrames: 128,
				channelCount: 2,
				maximumInFlightChunks: 1,
			},
		});
		const messages = captureMessages(processor);
		assert.equal(processor.process(inputBlock(2), outputBlock(2)), true);
		processor.port.onmessage?.({ data: { type: 'release-chunk' } });
		setCurrentFrame(128);
		assert.equal(processor.process(inputBlock(2), outputBlock(2)), false);
		const chunks = messages.filter(({ type }) => type === 'audio-chunk');
		assert.deepEqual(chunks.map(({ frames }) => frames), [128, 128]);
		assert.equal(messages.at(-1)?.type, 'done');
	});
});

test('realtime capture worklet transfers tight full and final-partial packets', () => {
	withCurrentFrame(() => {
		const processor = new RenderCaptureProcessor({
			processorOptions: {
				startFrame: 0,
				totalFrames: 160,
				chunkFrames: 128,
				channelCount: 2,
				maximumInFlightChunks: 2,
			},
		});
		const transfers: Array<readonly ArrayBuffer[]> = [];
		const messages: WorkletMessage[] = [];
		processor.port.postMessage = (message: WorkletMessage, transfer: readonly ArrayBuffer[] = []) => {
			messages.push(message);
			transfers.push(transfer);
		};
		assert.equal(processor.process(inputBlock(2), outputBlock(2)), true);
		setCurrentFrame(128);
		assert.equal(processor.process(inputBlock(2), outputBlock(2)), false);
		const chunks = messages.filter(({ type }) => type === 'audio-chunk');
		assert.deepEqual(chunks.map(({ frames }) => frames), [128, 32]);
		for (const [index, chunk] of chunks.entries()) {
			assert.equal(chunk.channels?.length, 2);
			assert.equal(transfers[index].length, 2);
			for (const channel of chunk.channels ?? []) {
				assert.equal(channel.byteOffset, 0);
				assert.equal(channel.byteLength, channel.buffer.byteLength);
			}
			assert.notEqual(chunk.channels?.[0].buffer, chunk.channels?.[1].buffer);
		}
	});
});

function captureMessages(processor: RenderCaptureProcessor): WorkletMessage[] {
	const messages: WorkletMessage[] = [];
	processor.port.postMessage = (message: WorkletMessage) => { messages.push(message); };
	return messages;
}

function inputBlock(channelCount: number): Float32Array[][] {
	return [Array.from({ length: channelCount }, () => new Float32Array(128))];
}

function outputBlock(channelCount: number): Float32Array[][] {
	return [Array.from({ length: channelCount }, () => new Float32Array(128))];
}

function setCurrentFrame(value: number): void {
	(globalThis as typeof globalThis & { currentFrame: number }).currentFrame = value;
}

function withCurrentFrame(run: () => void): void {
	const scope = globalThis as typeof globalThis & { currentFrame?: number };
	const previous = scope.currentFrame;
	setCurrentFrame(0);
	try {
		run();
	} finally {
		if (previous === undefined) delete scope.currentFrame;
		else setCurrentFrame(previous);
	}
}
