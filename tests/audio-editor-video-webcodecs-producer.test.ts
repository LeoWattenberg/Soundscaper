/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	frameTimestamp,
	produceVideoWebCodecsStream,
	VIDEO_WEBCODECS_MAXIMUM_QUEUE_DEPTH,
	type VideoWebCodecsProduceRequest,
} from '../src/common/editor/video-webcodecs-producer.ts';
import { resolveVideoDeliveryWebCodecsBitrate } from '../src/common/editor/video-delivery-quality.ts';

const RATE_2997 = { num: 30_000, den: 1_001 };

test('every frame is rendered, encoded, and written out in order', async () => {
	const harness = createHarness({ frameCount: 3 });
	const result = await produceVideoWebCodecsStream(harness.request);

	// H.264 adds no framing of its own, so the stream is exactly its chunks.
	assert.deepEqual({ ...result }, { frameCount: 3, chunkCount: 3, byteLength: 12 });
	assert.deepEqual(harness.renderedFrames, [0, 1, 2]);
	// The first frame is asked for as a keyframe so the stream decodes from its
	// own start; after that the encoder decides.
	assert.deepEqual(harness.keyFrameFlags, [true, false, false]);
});

test('timestamps come from the rational rate, not a decimal standing in for it', () => {
	assert.equal(frameTimestamp(0, RATE_2997), 0);
	assert.equal(frameTimestamp(1, RATE_2997), 33_367);
	// An hour's worth of frames at 29.97, which is 3599.9964 seconds and not
	// 3600: a decimal rate loses that, the rational keeps it exactly.
	assert.equal(frameTimestamp(107_892, RATE_2997), 3_599_996_400);
});

test('an H.264 stream is written bare and a VP9 one gets its IVF framing', async () => {
	const h264 = createHarness({ frameCount: 2, videoCodec: 'h264' });
	await produceVideoWebCodecsStream(h264.request);
	assert.equal(h264.written.length, 2, 'no header segment precedes the frames');
	assert.deepEqual([...h264.written[0]!], [1, 2, 3, 4]);

	const vp9 = createHarness({ frameCount: 2, videoCodec: 'vp9' });
	await produceVideoWebCodecsStream(vp9.request);
	assert.equal(vp9.written.length, 3, 'the IVF file header, then two framed chunks');
	assert.equal(new TextDecoder().decode(vp9.written[0]!.subarray(0, 4)), 'DKIF');
});

test('the encoder is configured with what the plan decided and nothing else', async () => {
	const harness = createHarness({ frameCount: 1 });
	await produceVideoWebCodecsStream(harness.request);

	assert.deepEqual(harness.configs[0], {
		codec: 'avc1.4d001f',
		width: 4,
		height: 2,
		framerate: 30_000 / 1_001,
		bitrate: 5_000,
		avc: { format: 'annexb' },
	});
});

test('frames do not pile up in the encoder queue', async () => {
	const harness = createHarness({ frameCount: 12, holdQueue: true });
	await produceVideoWebCodecsStream(harness.request);

	assert.ok(
		harness.maximumObservedQueue <= VIDEO_WEBCODECS_MAXIMUM_QUEUE_DEPTH + 1,
		`queue reached ${harness.maximumObservedQueue}; one RGBA frame is megabytes`,
	);
});

test('waiting for the queue yields the thread to the encoder that has to drain it', {
	// Left to hang, this would take the page down with it rather than fail.
	timeout: 20_000,
}, async () => {
	const harness = createHarness({ frameCount: 12, holdQueue: true, drainOnTask: true });
	await produceVideoWebCodecsStream(harness.request);

	assert.equal(harness.renderedFrames.length, 12);
	assert.equal(harness.written.length, 12);
	assert.ok(
		harness.maximumObservedQueue <= VIDEO_WEBCODECS_MAXIMUM_QUEUE_DEPTH + 1,
		`queue reached ${harness.maximumObservedQueue}; one RGBA frame is megabytes`,
	);
});

test('an encoder error surfaces rather than a short stream being called a success', async () => {
	const harness = createHarness({ frameCount: 4, failAtFrame: 2 });

	await assert.rejects(produceVideoWebCodecsStream(harness.request), /encoder gave up/u);
	assert.equal(harness.closed, true, 'the encoder is closed even when it failed');
});

test('an aborted export stops and closes rather than finishing quietly', async () => {
	const controller = new AbortController();
	const harness = createHarness({ frameCount: 6, onFrame: (index) => { if (index === 2) controller.abort(); } });

	await assert.rejects(
		produceVideoWebCodecsStream({ ...harness.request, signal: controller.signal }),
		(error: Error) => error.name === 'AbortError',
	);
	assert.equal(harness.closed, true);
	assert.ok(harness.renderedFrames.length < 6);
});

test('the delivery tier becomes a bitrate the same way it becomes a CRF', () => {
	const canvas = { width: 1_280, height: 720, frameRate: { num: 30, den: 1 } };

	assert.equal(resolveVideoDeliveryWebCodecsBitrate('h264', 'balanced', canvas), 2_764_800);
	assert.ok(
		resolveVideoDeliveryWebCodecsBitrate('h264', 'draft', canvas)
		< resolveVideoDeliveryWebCodecsBitrate('h264', 'high', canvas),
	);
	// VP9 reaches the same picture at a lower rate, so the same tier asks for less.
	assert.ok(
		resolveVideoDeliveryWebCodecsBitrate('vp9', 'balanced', canvas)
		< resolveVideoDeliveryWebCodecsBitrate('h264', 'balanced', canvas),
	);
	assert.throws(() => resolveVideoDeliveryWebCodecsBitrate('av1', 'balanced', canvas), /No delivery bitrate mapping/u);
});

function createHarness(options: {
	frameCount: number;
	videoCodec?: string;
	holdQueue?: boolean;
	drainOnTask?: boolean;
	failAtFrame?: number;
	onFrame?: (index: number) => void;
}) {
	const renderedFrames: number[] = [];
	const written: Uint8Array[] = [];
	const configs: Record<string, unknown>[] = [];
	const keyFrameFlags: boolean[] = [];
	const harness = {
		renderedFrames,
		written,
		configs,
		keyFrameFlags,
		closed: false,
		maximumObservedQueue: 0,
		request: null as unknown as VideoWebCodecsProduceRequest,
	};
	let output: ((chunk: { byteLength: number; copyTo(target: Uint8Array): void }) => void) | null = null;
	let onError: ((error: unknown) => void) | null = null;
	const queued: number[] = [];

	class FakeEncoder {
		state = 'configured';

		constructor(callbacks: { output: typeof output; error: typeof onError }) {
			output = callbacks.output;
			onError = callbacks.error;
		}

		get encodeQueueSize() {
			harness.maximumObservedQueue = Math.max(harness.maximumObservedQueue, queued.length);
			return queued.length;
		}

		configure(config: Record<string, unknown>) { configs.push(config); }

		encode(_frame: unknown, encodeOptions?: { keyFrame?: boolean }) {
			keyFrameFlags.push(Boolean(encodeOptions?.keyFrame));
			const index = keyFrameFlags.length - 1;
			if (options.failAtFrame === index) { onError?.(new Error('the encoder gave up')); return; }
			queued.push(index);
			// Without the hold, chunks come straight back as most software
			// encoders deliver them; with it, the queue is left to grow.
			if (!options.holdQueue) this.#emit();
			// A real encoder works and calls back in tasks, never in microtasks,
			// so a producer that waits on microtasks alone never sees it drain.
			else if (options.drainOnTask) setTimeout(() => { this.#emit(); }, 0);
			else queueMicrotask(() => { this.#emit(); });
		}

		#emit() {
			if (queued.length === 0) return;
			queued.shift();
			output?.({ byteLength: 4, copyTo: (target: Uint8Array) => target.set([1, 2, 3, 4]) });
		}

		async flush() { while (queued.length > 0) this.#emit(); }

		close() { harness.closed = true; this.state = 'closed'; }
	}

	class FakeVideoFrame {
		constructor(_data: Uint8Array, _init: Record<string, unknown>) {}
		close() {}
	}

	harness.request = {
		frameSource: {
			frameCount: options.frameCount,
			canvas: { width: 4, height: 2, frameRate: RATE_2997 },
			frame: (index: number) => ({ index }),
		},
		producer: {
			byteLength: 4 * 2 * 4,
			produce: (frame: { index: number }) => {
				renderedFrames.push(frame.index);
				options.onFrame?.(frame.index);
			},
		},
		videoCodec: options.videoCodec ?? 'h264',
		codec: 'avc1.4d001f',
		bitrate: 5_000,
		encoderClass: FakeEncoder,
		videoFrameClass: FakeVideoFrame,
		write: (bytes: Uint8Array) => { written.push(bytes); },
	} as unknown as VideoWebCodecsProduceRequest;
	return harness;
}
