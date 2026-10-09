/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createFramescaperBrowserAudioRecorder, type FramescaperAudioDataLike } from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';
import type { CapturePcmChunk } from '../src/common/editor/controller/capture/internal/framescaper-capture-pcm-packetizer.ts';
import { deferred, waitFor } from './helpers/async-test-control.ts';

class NativeAudioBlock implements FramescaperAudioDataLike {
	readonly sampleRate = 48_000;
	readonly numberOfChannels = 2;
	readonly numberOfFrames = 480;
	closed = false;
	readonly channels: readonly Float32Array[];
	constructor(start: number) {
		this.channels = [0, 1].map(channel => Float32Array.from({ length: 480 }, (_, index) =>
			0.2 * Math.sin((start + index) * (channel + 1) / 17)));
	}
	copyTo(target: Float32Array, options: Readonly<{ planeIndex: number; frameOffset?: number; frameCount?: number }>): void {
		const offset = options.frameOffset ?? 0;
		target.set(this.channels[options.planeIndex]!.subarray(offset, offset + (options.frameCount ?? 480)));
	}
	close(): void { assert.equal(this.closed, false); this.closed = true; }
}

function nativeProcessor() {
	type Result = Readonly<{ done: boolean; value?: NativeAudioBlock }>;
	const queued: Result[] = [];
	let waiting: ((result: Result) => void) | null = null;
	let releaseCalls = 0;
	function deliver(result: Result): void {
		if (waiting) { const resolve = waiting; waiting = null; resolve(result); }
		else queued.push(result);
	}
	const reader = {
		read: () => queued.length ? Promise.resolve(queued.shift()!) : new Promise<Result>(resolve => { waiting = resolve; }),
		cancel: () => { queued.length = 0; deliver({ done: true }); },
		releaseLock() { releaseCalls += 1; },
	};
	return {
		Processor: class { readonly readable = { getReader: () => reader }; },
		push: (value: NativeAudioBlock) => { deliver({ done: false, value }); },
		releaseCalls: () => releaseCalls,
	};
}

test('normal native ten-millisecond AudioData uses the advertised PCM storage budget and flushes its final tail', async () => {
	const processor = nativeProcessor();
	const storage = deferred<void>();
	const chunks: CapturePcmChunk[] = [];
	const errors: unknown[] = [];
	const blocks = Array.from({ length: 40 }, (_, index) => new NativeAudioBlock(index * 480));
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track: { kind: 'audio', getSettings: () => ({ sampleRate: 48_000, channelCount: 2 }) },
		stream: {}, MediaStreamTrackProcessor: processor.Processor, inputGain: 0.5,
		onChunk: async chunk => { chunks.push(chunk); await storage.promise; },
		onError: error => { errors.push(error); },
	});
	recorder.start(960);
	try {
		for (const block of blocks) { processor.push(block); await delay(10); }
		assert.deepEqual(errors, [], '400 ms of ordinary PCM must fit the unchanged 32 nominal-chunk budget');
		assert.equal(recorder.state, 'recording');
		assert.equal(recorder.pendingChunks, 4);
		storage.resolve();
		await recorder.stop();
		assert.deepEqual(chunks.map(({ frameStart, frames }) => ({ frameStart, frames })), [
			{ frameStart: 960, frames: 4096 }, { frameStart: 5056, frames: 4096 },
			{ frameStart: 9152, frames: 4096 }, { frameStart: 13248, frames: 4096 },
			{ frameStart: 17344, frames: 2816 },
		]);
		for (const channel of [0, 1]) {
			const expected = blocks.flatMap(block => [...block.channels[channel]!].map(value => Math.fround(value * 0.5)));
			assert.deepEqual(chunks.flatMap(chunk => [...chunk.channels[channel]!]), expected);
		}
		assert.ok(blocks.every(block => block.closed));
		assert.equal(processor.releaseCalls(), 1);
	} finally { storage.resolve(); await recorder.dispose().catch(() => undefined); }
});

test('native partial chunks flush before Pause so skipped input stays an exact gap', async () => {
	const processor = nativeProcessor();
	const chunks: CapturePcmChunk[] = [];
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'system-audio', track: { kind: 'audio', getSettings: () => ({ sampleRate: 48_000, channelCount: 2 }) },
		stream: {}, MediaStreamTrackProcessor: processor.Processor,
		onChunk: chunk => { chunks.push(chunk); },
	});
	recorder.start();
	const before = new NativeAudioBlock(0);
	processor.push(before);
	await waitFor(() => before.closed, 'the first native block');
	assert.equal(recorder.pause(), true);
	assert.equal(recorder.acceptedInputFrameEnd, 480, 'the pause fence includes the held partial PCM');
	const paused = new NativeAudioBlock(480);
	processor.push(paused);
	await waitFor(() => paused.closed, 'the paused native block');
	assert.equal(recorder.resume(), true);
	const after = new NativeAudioBlock(960);
	processor.push(after);
	await waitFor(() => after.closed, 'the resumed native block');
	await recorder.stop();
	assert.deepEqual(chunks.map(({ frameStart, frames }) => ({ frameStart, frames })), [
		{ frameStart: 0, frames: 480 }, { frameStart: 960, frames: 480 },
	]);
	assert.deepEqual([...chunks[1]!.channels[0]!], [...after.channels[0]!]);
	await recorder.dispose();
});
