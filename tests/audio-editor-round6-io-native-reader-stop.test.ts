/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createFramescaperBrowserAudioRecorder,
	type FramescaperAudioDataLike,
} from '../src/common/editor/controller/capture/internal/browser/framescaper-browser-audio-recorder.ts';

for (const closeAtStop of [false, true]) {
	test(`normal native source closure during Stop (${String(closeAtStop)}) retains its PCM tail`, async () => {
		let controller!: ReadableStreamDefaultController<FramescaperAudioDataLike>;
		const readable = new ReadableStream<FramescaperAudioDataLike>({
			start(value) { controller = value; },
		});
		let copied = false;
		const samples = Float32Array.from({ length: 480 }, (_, index) => index / 480);
		const chunks: number[] = [];
		const recorder = await createFramescaperBrowserAudioRecorder({
			role: 'microphone', track: { kind: 'audio', getSettings: () => ({ sampleRate: 48_000, channelCount: 1 }) },
			stream: {},
			MediaStreamTrackProcessor: class { readonly readable = readable; },
			onChunk(chunk) { chunks.push(chunk.frames); assert.deepEqual(chunk.channels[0], samples); },
		});
		await recorder.start();
		controller.enqueue({
			numberOfFrames: 480, numberOfChannels: 1, sampleRate: 48_000,
			copyTo(destination, options) {
				destination.set(samples.subarray(options.frameOffset ?? 0, (options.frameOffset ?? 0) + (options.frameCount ?? 480)));
				copied = true;
			},
			close() {},
		});
		while (!copied) await Promise.resolve();
		const stopped = recorder.stop();
		// The session retires its normal preview lease immediately after requesting
		// recorder Stop; ending the native source closes its actual ReadableStream.
		if (closeAtStop) controller.close();
		await stopped;
		assert.equal(recorder.state, 'stopped');
		assert.deepEqual(chunks, [480]);
		await recorder.dispose();
		assert.equal(recorder.state, 'disposed');
	});
}
