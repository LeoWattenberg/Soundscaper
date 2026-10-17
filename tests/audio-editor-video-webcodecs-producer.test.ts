/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred } from './helpers/async-test-control.ts';

import {
	frameTimestamp,
	produceVideoWebCodecsChunks,
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

test('frame durations span adjacent rational timestamps without gaps or overlaps', async () => {
	const harness = createHarness({ frameCount: 3 });
	await produceVideoWebCodecsStream(harness.request);

	assert.deepEqual(harness.frameDurations, [33_367, 33_366, 33_367]);
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

test('native mux production requests AVC and preserves each chunk metadata callback', async () => {
	const metadata = {
		decoderConfig: {
			codec: 'avc1.4d001f',
			codedWidth: 4,
			codedHeight: 2,
			description: Uint8Array.of(1, 0x4d, 0, 0x1f),
		},
	} as EncodedVideoChunkMetadata;
	const harness = createHarness({ frameCount: 1, metadata });
	const received: Readonly<{ chunk: unknown; metadata?: EncodedVideoChunkMetadata }>[] = [];
	await produceVideoWebCodecsChunks({
		...harness.request,
		h264Format: 'avc',
		writeChunk(chunk, emittedMetadata) {
			(received as { chunk: unknown; metadata?: EncodedVideoChunkMetadata }[]).push({
				chunk,
				...(emittedMetadata ? { metadata: emittedMetadata } : {}),
			});
		},
	});

	assert.deepEqual(harness.configs[0], {
		codec: 'avc1.4d001f',
		width: 4,
		height: 2,
		framerate: 30_000 / 1_001,
		bitrate: 5_000,
		avc: { format: 'avc' },
	});
	assert.equal(received.length, 1);
	assert.equal(received[0]?.metadata, metadata, 'decoder configuration reaches the muxer intact');
	assert.deepEqual(received[0]?.chunk, harness.emittedChunks[0]);
});

test('production preserves the hardware preference accepted by the desktop capability probe', async () => {
	const harness = createHarness({ frameCount: 1 });
	await produceVideoWebCodecsStream({ ...harness.request, hardwareAcceleration: 'prefer-hardware' });
	assert.equal(harness.configs[0]?.hardwareAcceleration, 'prefer-hardware');
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

test('an abort interrupts a pending encoder flush and closes the encoder', {
	timeout: 2_000,
}, async () => {
	const controller = new AbortController();
	const harness = createHarness({
		frameCount: 1,
		hangFlush: true,
		onFlush: () => controller.abort(),
	});

	await assert.rejects(
		produceVideoWebCodecsStream({ ...harness.request, signal: controller.signal }),
		(error: Error) => error.name === 'AbortError',
	);
	assert.equal(harness.closed, true);
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
		hangFlush?: boolean;
		onFlush?: () => void;
		metadata?: EncodedVideoChunkMetadata;
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
		frameDurations: [] as number[],
		frameInits: [] as Record<string, unknown>[],
		frameData: [] as Uint8Array[],
		encoderConstructions: 0,
		closed: false,
		maximumObservedQueue: 0,
		emittedChunks: [] as unknown[],
		request: null as unknown as VideoWebCodecsProduceRequest,
	};
	let output: ((chunk: {
		byteLength: number;
		type: 'key' | 'delta';
		timestamp: number;
		duration: number;
		copyTo(target: Uint8Array): void;
	}, metadata?: EncodedVideoChunkMetadata) => void) | null = null;
	let onError: ((error: unknown) => void) | null = null;
	const queued: number[] = [];

	class FakeEncoder {
		state = 'configured';

		constructor(callbacks: { output: typeof output; error: typeof onError }) {
			harness.encoderConstructions += 1;
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
			const index = queued.shift()!;
			const chunk = {
				byteLength: 4,
				type: index === 0 ? 'key' as const : 'delta' as const,
				timestamp: frameTimestamp(index, RATE_2997),
				duration: frameTimestamp(1, RATE_2997),
				copyTo: (target: Uint8Array) => target.set([1, 2, 3, 4]),
			};
			harness.emittedChunks.push(chunk);
			output?.(chunk, options.metadata);
		}

		async flush() {
			while (queued.length > 0) this.#emit();
			options.onFlush?.();
			if (options.hangFlush) await new Promise<never>(() => undefined);
		}

		close() { harness.closed = true; this.state = 'closed'; }
	}

	class FakeVideoFrame {
		constructor(data: Uint8Array, init: Record<string, unknown>) {
			harness.frameData.push(data);
			harness.frameInits.push(init);
			harness.frameDurations.push(Number(init.duration));
		}
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

for (const [rgbaColorSpace, transfer] of [['srgb', 'iec61966-2-1'], ['rec709', 'bt709']] as const) {
	test(`I420 VideoFrames carry declared ${rgbaColorSpace} rather than native defaults`, async () => {
		const harness = createHarness({ frameCount: 1 });
		await produceVideoWebCodecsStream({ ...harness.request, rgbaColorSpace } as VideoWebCodecsProduceRequest);
		assert.equal(harness.frameInits[0]?.format, 'I420');
		assert.deepEqual(harness.frameInits[0]?.colorSpace, {
			primaries: 'bt709', transfer, matrix: 'bt709', fullRange: false,
		});
	});
}

test('legacy unlabelled RGBA retains the exact native default init shape', async () => {
	const harness = createHarness({ frameCount: 1 });
	await produceVideoWebCodecsStream(harness.request);
	assert.deepEqual(harness.frameInits[0], {
		format: 'RGBA', codedWidth: 4, codedHeight: 2, timestamp: 0, duration: 33_367,
	});
});

test('the declared profile is captured before a held renderer can replace it', async () => {
	const harness = createHarness({ frameCount: 1 });
	const request = { ...harness.request, rgbaColorSpace: 'rec709' };
	request.producer = { ...request.producer, async produce() {
		request.rgbaColorSpace = 'srgb';
		await Promise.resolve();
	} };
	await produceVideoWebCodecsStream(request as VideoWebCodecsProduceRequest);
	assert.equal((harness.frameInits[0]?.colorSpace as Record<string, unknown>).transfer, 'bt709');
});

test('a held nonempty VP9 header cannot add a profile to an omitted legacy request', async () => {
	const harness = createHarness({ frameCount: 1, videoCodec: 'vp9' });
	const entered = deferred<void>();
	const release = deferred<void>();
	let writes = 0;
	const request = { ...harness.request, async write(bytes: Uint8Array) {
		if (writes++ === 0) { assert.equal(bytes.byteLength, 32); entered.resolve(); await release.promise; }
		await harness.request.write(bytes);
	} };
	const pending = produceVideoWebCodecsStream(request);
	await entered.promise;
	Object.defineProperty(request, 'rgbaColorSpace', { enumerable: true, value: 'srgb' });
	release.resolve();
	await pending;
	assert.equal(Object.hasOwn(harness.frameInits[0]!, 'colorSpace'), false);
});

test('a held nonempty VP9 header cannot invoke a post-capture profile getter', async () => {
	const harness = createHarness({ frameCount: 1, videoCodec: 'vp9' });
	const entered = deferred<void>();
	const release = deferred<void>();
	let writes = 0; let reads = 0;
	const request = { ...harness.request, rgbaColorSpace: 'rec709' as const, async write(bytes: Uint8Array) {
		if (writes++ === 0) { assert.equal(bytes.byteLength, 32); entered.resolve(); await release.promise; }
		await harness.request.write(bytes);
	} };
	const pending = produceVideoWebCodecsStream(request);
	await entered.promise;
	Object.defineProperty(request, 'rgbaColorSpace', { enumerable: true, get() { reads++; return 'srgb'; } });
	release.resolve();
	await pending;
	assert.equal(reads, 0);
	assert.equal((harness.frameInits[0]?.colorSpace as Record<string, unknown>).transfer, 'bt709');
});

test('unsupported and accessor profiles refuse before native construction without executing getters', async () => {
	let reads = 0;
	for (const profile of ['linear-rec709-d65', 'display-p3', null, undefined]) {
		const harness = createHarness({ frameCount: 1 });
		await assert.rejects(produceVideoWebCodecsStream({ ...harness.request, rgbaColorSpace: profile } as never));
		assert.equal(harness.encoderConstructions, 0);
	}
	const harness = createHarness({ frameCount: 1 });
	const request = Object.defineProperty({ ...harness.request }, 'rgbaColorSpace', {
		enumerable: true, get() { reads += 1; return 'srgb'; },
	});
	await assert.rejects(produceVideoWebCodecsStream(request));
	assert.equal(reads, 0);
	assert.equal(harness.encoderConstructions, 0);
	const inherited = Object.setPrototypeOf({ ...harness.request }, { get rgbaColorSpace() { reads++; return 'srgb'; } });
	await assert.rejects(produceVideoWebCodecsStream(inherited));
	assert.equal(reads, 0);
	assert.equal(harness.encoderConstructions, 0);
});

test('explicit I420 admission rejects odd, mismatched and excessive frames before native construction', async () => {
	for (const [width, height, byteLength] of [[3, 2, 24], [4, 2, 31], [4096, 4096, 67_108_864]]) {
		const harness = createHarness({ frameCount: 1 });
		const request = { ...harness.request, rgbaColorSpace: 'rec709' as const,
			frameSource: { ...harness.request.frameSource, canvas: { width: width!, height: height!, frameRate: RATE_2997 } },
			producer: { ...harness.request.producer, byteLength: byteLength! } };
		await assert.rejects(produceVideoWebCodecsStream(request));
		assert.equal(harness.encoderConstructions, 0);
	}
});

test('explicit I420 reuses one plane and joins held delivery before wiping both workspaces', async () => {
	const harness = createHarness({ frameCount: 2 });
	const entered = deferred<void>(), release = deferred<void>();
	const rendered: Uint8Array[] = [];
	const observed: number[][] = [];
	const request = { ...harness.request, rgbaColorSpace: 'rec709' as const,
		producer: { byteLength: 32, produce(_frame: unknown, rgba: Uint8Array) { rgba.fill(180); rendered.push(rgba); } },
		async write() {
			observed.push([...harness.frameData.at(-1)!]);
			if (observed.length === 1) { entered.resolve(); await release.promise; }
		} };
	let settled = false;
	const pending = produceVideoWebCodecsStream(request).finally(() => { settled = true; });
	await entered.promise;
	assert.equal(settled, false);
	assert.equal(rendered[0]![0], 180);
	assert.deepEqual([...harness.frameData[0]!], [171,171,171,171,171,171,171,171,128,128,128,128]);
	release.resolve(); await pending;
	assert.equal(harness.frameData[0], harness.frameData[1]);
	assert.equal(rendered[0], rendered[1]);
	assert.ok(rendered[0]!.every(value => value === 0));
	assert.ok(harness.frameData[0]!.every(value => value === 0));
	assert.equal(observed.length, 2);
});

test('cancelled held rendering joins before wipe and no frame is encoded', async () => {
	const harness = createHarness({ frameCount: 1 });
	const controller = new AbortController(), entered = deferred<void>(), release = deferred<void>();
	let borrowed: Uint8Array | undefined, settled = false;
	const pending = produceVideoWebCodecsStream({ ...harness.request, rgbaColorSpace: 'srgb', signal: controller.signal,
		producer: { byteLength: 32, async produce(_frame, rgba) { borrowed = rgba; rgba.fill(180); entered.resolve(); await release.promise; } },
	}).finally(() => { settled = true; });
	await entered.promise; controller.abort(); await Promise.resolve();
	assert.equal(settled, false); assert.equal(borrowed![0], 180);
	release.resolve(); await assert.rejects(pending, { name: 'AbortError' });
	assert.ok(borrowed!.every(value => value === 0)); assert.equal(harness.frameData.length, 0);
});

test('opaque renderer or delivery failure is retained while owned planes are wiped', async () => {
	for (const stage of ['render', 'delivery'] as const) {
		const harness = createHarness({ frameCount: 1 }), primary = Symbol(stage);
		let borrowed: Uint8Array | undefined;
		const request = { ...harness.request, rgbaColorSpace: 'rec709' as const,
			producer: { byteLength: 32, produce(_frame: unknown, rgba: Uint8Array) { borrowed = rgba; rgba.fill(180); if (stage === 'render') throw primary; } },
			write() { throw primary; } };
		await assert.rejects(produceVideoWebCodecsStream(request), error => error === primary);
		assert.ok(borrowed!.every(value => value === 0));
		assert.ok(harness.frameData.every(bytes => bytes.every(value => value === 0)));
	}
});

test('explicit admission captures producer storage length before native construction', async () => {
	const harness = createHarness({ frameCount: 1 });
	let reads = 0;
	const producer = { ...harness.request.producer, get byteLength() { return ++reads === 1 ? 32 : 64; } };
	await produceVideoWebCodecsStream({ ...harness.request, producer, rgbaColorSpace: 'rec709' });
	assert.equal(reads,1); assert.equal(harness.frameData[0]!.byteLength,12);
});

test('detached owned renderer and delivery backings cannot replace their opaque failure', async () => {
	for (const stage of ['render','delivery'] as const) {
		const harness = createHarness({ frameCount: 1 }), primary = Symbol(stage);
		const pending = produceVideoWebCodecsStream({ ...harness.request, rgbaColorSpace: 'srgb',
			producer: { byteLength:32, produce(_frame,rgba) {
				rgba.fill(180);
				if (stage === 'render') { structuredClone(rgba.buffer,{transfer:[rgba.buffer]}); throw primary; }
			} },
			write() { const plane = harness.frameData[0]!; structuredClone(plane.buffer,{transfer:[plane.buffer]}); throw primary; },
		});
		await assert.rejects(pending,error => error === primary);
		assert.equal(harness.closed,true);
	}
});

test('cancellation joins a held writer before wiping its live I420 backing', async () => {
	const harness = createHarness({ frameCount:1 }), controller = new AbortController();
	const entered = deferred<void>(), release = deferred<void>();
	let settled = false;
	const pending = produceVideoWebCodecsStream({ ...harness.request, rgbaColorSpace:'rec709', signal:controller.signal,
		producer: { byteLength:32, produce(_frame,rgba) { rgba.fill(180); } },
		async write() { entered.resolve(); await release.promise; },
	}).finally(() => { settled = true; });
	await entered.promise; controller.abort(); await Promise.resolve();
	assert.equal(settled,false); assert.equal(harness.frameData[0]![0],171);
	release.resolve(); await assert.rejects(pending,{name:'AbortError'});
	assert.ok(harness.frameData[0]!.every(value => value === 0));
});

test('cleanup uses intrinsic owned storage even when a failing borrower replaces its view prototype', async () => {
	for (const stage of ['render','delivery'] as const) {
		const harness = createHarness({frameCount:1}), primary = Symbol(stage);
		await assert.rejects(produceVideoWebCodecsStream({ ...harness.request, rgbaColorSpace:'rec709',
			producer: {byteLength:32,produce(_frame,rgba) { rgba.fill(180); if (stage === 'render') { Object.setPrototypeOf(rgba,null); throw primary; } }},
			write() { Object.setPrototypeOf(harness.frameData[0]!,null); throw primary; },
		}),error => error === primary);
	}
});
