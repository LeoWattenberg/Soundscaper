/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { MOTION_WEBM_TIMECODE_QUANTUM_SECONDS, motionVideoFrameTimestamp, motionVideoPixels, normalizeMotionVideoDelivery, normalizeMotionVideoAudio } from '../src/common/editor/motion-video-delivery.ts';
import { createMotionBrowserVideoSink, type MotionVideoHost } from '../src/common/editor/controller/export/motion-browser-video.ts';
import type { MotionRenderFrame, MotionRenderPlan } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
import type { MotionAudioMixBlock } from '../src/common/editor/motion-audio-contract.ts';
import { addRationals, divideRationals, multiplyRationals } from '../src/common/editor/timeline-time.ts';

const plan: MotionRenderPlan = { identity: { projectId: 'motion', compositionId: 'comp', revisionDigest: 'a'.repeat(64) },
	width: 2, height: 2, frameRate: { num: 30000, den: 1001 }, firstFrame: 100, frameCount: 2 };
const frame = (index: number): MotionRenderFrame => ({ index, time: { num: (100 + index) * 1001, den: 30000 }, duration: { num: 1001, den: 30000 },
	surface: { ...createMotionSurface(2, 2, [1, 0.5, 0, 0.5]), consumedOperationIds: [] } });
function createFixture() {
	const events: string[] = []; const timestamps: number[] = []; let frameClosed = 0; let writable: WritableStream<Uint8Array> | undefined;
	const host: MotionVideoHost = {
		async supported() { return true; },
		async supportedAudio() { return true; },
		createFrame(_bytes, init) { timestamps.push(init.timestamp); return { close() { frameClosed += 1; } }; },
		createEncoder(callbacks) {
			let timestamp = 0;
			return { configure() { events.push('configure'); }, encode(_frame, options) { timestamp = timestamps.at(-1)!; assert.equal(options.keyFrame, true); },
				async flush() { callbacks.output({ timestamp, type: 'key', byteLength: 3, copyTo(bytes) { bytes.set([1, 2, 3]); } }); }, close() { events.push('encoder-close'); } };
		},
		async createMuxer(_format, _plan, output) {
			writable = output;
			const writer = output.getWriter();
			return { async add(packet) { assert.deepEqual([...packet.bytes], [1, 2, 3]); await writer.write(packet.bytes); events.push('packet'); },
				async finish() { await writer.close(); writer.releaseLock(); events.push('mux-finish'); },
				async cancel() { await writer.abort(); writer.releaseLock(); events.push('mux-cancel'); } };
		},
	};
	return { host, events, timestamps, closed: () => frameClosed, writable: () => writable };
}
test('M05 opaque video composites its selected background in linear light before Rec.709 encoding', () => {
	const bytes = motionVideoPixels(createMotionSurface(1, 1, [1, 0, 0, 0.5]), [0, 0, 1]);
	assert.deepEqual([...bytes], [180, 0, 180, 255]);
	assert.deepEqual([...motionVideoPixels(createMotionSurface(1, 1), [0, 1, 0])], [0, 255, 0, 255]);
});
test('M05 video timestamp rounding uses exact rational arithmetic and rejects unrepresentable time', () => {
	assert.equal(MOTION_WEBM_TIMECODE_QUANTUM_SECONDS, 0.001);
	assert.equal(motionVideoFrameTimestamp(1, plan.frameRate), 33367);
	assert.equal(motionVideoFrameTimestamp(2, plan.frameRate), 66733);
	assert.equal(motionVideoFrameTimestamp(100_000_000, { num: 24000, den: 1001 }), 4170833333333);
	assert.throws(() => motionVideoFrameTimestamp(Number.MAX_SAFE_INTEGER, { num: 1, den: 1 }), /timestamp/u);
});
test('M05 video admission bounds container indexes and refuses incompatible canvas or frame rates', () => {
	assert.throws(() => normalizeMotionVideoDelivery({ plan: { ...plan, frameCount: 1_000_000 }, format: 'webm' }), /range.*long/u);
	assert.throws(() => normalizeMotionVideoDelivery({ plan: { ...plan, width: 3 }, format: 'mp4' }), /even/u);
	assert.throws(() => normalizeMotionVideoDelivery({ plan: { ...plan, frameRate: { num: 1_000_001, den: 1 } }, format: 'webm' }), /frame rate/u);
});

test('M05 audio video admission bounds queued interleaving and audio packet indexes', () => {
	const audio = normalizeMotionVideoAudio(plan, 'webm', { sampleRate: 48000, channels: 2 });
	assert.equal(audio.codec, 'opus'); assert.equal(audio.sampleCount, 3204);
	assert.throws(() => normalizeMotionVideoAudio({ ...plan, frameRate: { num: 1, den: 10 } }, 'webm', { sampleRate: 48000, channels: 2 }), /interleav/u);
	assert.throws(() => normalizeMotionVideoAudio({ ...plan, frameCount: 32768 }, 'webm', { sampleRate: 48000, channels: 2 }), /audio.*index/u);
});

test('M05 video consumes ordered revision-bound PCM before each frame and cannot publish missing audio', async () => {
	const fixture = createFixture(); const samples: number[] = [];
	const sink = await createMotionBrowserVideoSink({ plan, format: 'webm', audio: { sampleRate: 48000, channels: 1 } }, {
		...fixture.host, async createMuxer(...args) { return { ...await fixture.host.createMuxer(...args),
			async addAudio(block, timestamp) { samples.push(block.sampleCount); assert.equal(timestamp, samples.length === 1 ? 0 : 1602 / 48000); } }; },
	});
	assert.ok(sink.audio);
	await assert.rejects(sink.write(frame(0)), /audio/u);
	const start = multiplyRationals(divideRationals(plan.firstFrame, plan.frameRate), 48000);
	const block = (offset: number): MotionAudioMixBlock => ({ projectId: 'motion', revision: 0, revisionDigest: 'a'.repeat(64), compositionId: 'comp',
		startSample: addRationals(start, offset), sampleRate: 48000, channels: 1, sampleCount: 1602, interleaved: new Float32Array(1602) });
	await assert.rejects(sink.audio.write({ ...block(0), revisionDigest: 'b'.repeat(64) }), /identity/u);
	await sink.audio.write(block(0)); await sink.write(frame(0));
	await assert.rejects(sink.audio.write(block(1602 + 1)), /timing/u);
	await sink.audio.write(block(1602)); await sink.write(frame(1)); await sink.finish();
	assert.deepEqual(samples, [1602, 1602]);
});

test('M05 unsupported audio refuses before muxer or destination admission', async () => {
	const fixture = createFixture();
	await assert.rejects(createMotionBrowserVideoSink({ plan, format: 'mp4', audio: { sampleRate: 48000, channels: 2 } }, {
		...fixture.host, async supportedAudio() { return false; },
	}), /AAC.*audio/u);
	assert.equal(fixture.writable(), undefined);
});

test('M05 audio muxer refusal and PCM backpressure cancel without publishing or advancing sample order', async () => {
	const fixture = createFixture(); let cancelled = 0; let committed = false;
	const writable = new WritableStream<Uint8Array>({ abort() { cancelled++; }, close() { committed = true; } });
	await assert.rejects(createMotionBrowserVideoSink({ plan, format: 'webm', audio: { sampleRate: 48000, channels: 1 }, writable }, fixture.host), /consume audio/u);
	assert.equal(cancelled, 1); assert.deepEqual(fixture.events, ['mux-cancel']);
	let unblock!: () => void; let enter!: () => void;
	const blocked = new Promise<void>((resolve) => { unblock = resolve; }); const entered = new Promise<void>((resolve) => { enter = resolve; });
	const sink = await createMotionBrowserVideoSink({ plan, format: 'webm', audio: { sampleRate: 48000, channels: 1 } }, {
		...fixture.host, async createMuxer(...args) { return { ...await fixture.host.createMuxer(...args), async addAudio() { enter(); await blocked; } }; },
	});
	assert.ok(sink.audio);
	const controller = new AbortController();
	const block: MotionAudioMixBlock = { projectId: 'motion', revision: 0, revisionDigest: 'a'.repeat(64), compositionId: 'comp',
		startSample: multiplyRationals(divideRationals(plan.firstFrame, plan.frameRate), 48000), sampleRate: 48000, channels: 1, sampleCount: 1602, interleaved: new Float32Array(1602) };
	const pending = sink.audio.write(block, controller.signal); await entered;
	await assert.rejects(sink.audio.write(block), /order/u); await assert.rejects(sink.finish(), /complete/u);
	controller.abort(new DOMException('PCM cancelled', 'AbortError')); unblock(); await assert.rejects(pending, /PCM cancelled/u);
	await sink.abort(controller.signal.reason); assert.equal(committed, false);
});
test('M05 video output rebases work areas, closes every frame and publishes only a complete stream', async () => {
	const fixture = createFixture();
	const sink = await createMotionBrowserVideoSink({ plan, format: 'webm' }, fixture.host);
	await sink.write(frame(0)); await assert.rejects(sink.finish(), /complete/u);
	await sink.write(frame(1));
	const blob = await sink.finish(); assert.ok(blob instanceof Blob);
	assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3, 1, 2, 3]);
	assert.equal(blob.type, 'video/webm');
	assert.deepEqual(fixture.timestamps, [0, 33367]); assert.equal(fixture.closed(), 2);
	assert.deepEqual(fixture.events, ['configure', 'packet', 'packet', 'encoder-close', 'mux-finish']);
});
test('M05 unsupported codecs never acquire a destination and cancellation aborts admitted output', async () => {
	const fixture = createFixture();
	await assert.rejects(createMotionBrowserVideoSink({ plan, format: 'mp4' }, { ...fixture.host, async supported() { return false; } }), /encoder/u);
	assert.equal(fixture.writable(), undefined);
	const reasons: unknown[] = [];
	const writable = new WritableStream<Uint8Array>({ abort(reason: unknown) { reasons.push(reason); } });
	const sink = await createMotionBrowserVideoSink({ plan, format: 'webm', writable }, fixture.host);
	const controller = new AbortController(); controller.abort(new DOMException('Cancelled', 'AbortError'));
	await assert.rejects(sink.write(frame(0), controller.signal), /Cancelled/u);
	await sink.abort(controller.signal.reason); await sink.abort(controller.signal.reason);
	assert.equal(reasons.length, 1); assert.equal(fixture.closed(), 0);
	await assert.rejects(sink.finish(), /closed/u);
});
test('M05 muxer admission and encoder configuration failure release every acquired destination', async () => {
	const fixture = createFixture(); const reasons: unknown[] = [];
	const failure = new Error('Muxer admission failed');
	const writable = new WritableStream<Uint8Array>({ abort(reason: unknown) { reasons.push(reason); } });
	await assert.rejects(createMotionBrowserVideoSink({ plan, format: 'webm', writable }, { ...fixture.host,
		async createMuxer() { throw failure; } }), (error: unknown) => error === failure);
	assert.deepEqual(reasons, [failure]); assert.equal(writable.locked, false);
	let encoderClosed = false;
	await assert.rejects(createMotionBrowserVideoSink({ plan, format: 'webm' }, { ...fixture.host,
		createEncoder() { return { configure() { throw failure; }, encode() {}, async flush() {}, close() { encoderClosed = true; } }; } }), (error: unknown) => error === failure);
	assert.equal(encoderClosed, true);
});
test('M05 cancellation during muxer admission closes output before creating an encoder', async () => {
	const fixture = createFixture(); const controller = new AbortController(); let closed = false;
	const reason = new DOMException('Cancelled during admission', 'AbortError');
	const writable = new WritableStream<Uint8Array>({ abort() { closed = true; } });
	await assert.rejects(createMotionBrowserVideoSink({ plan, format: 'webm', writable, signal: controller.signal }, {
		...fixture.host, async createMuxer(...args) {
			const muxer = await fixture.host.createMuxer(...args); controller.abort(reason); return muxer;
		},
	}), (error: unknown) => error === reason);
	assert.equal(closed, true); assert.deepEqual(fixture.events, ['mux-cancel']);
});
test('M05 video destination backpressure retains one packet and cancellation cannot close output', async () => {
	const fixture = createFixture(); const controller = new AbortController(); let closed = false;
	let unblock!: () => void; let entered!: () => void;
	const blocked = new Promise<void>((resolve) => { unblock = resolve; });
	const started = new Promise<void>((resolve) => { entered = resolve; });
	const writable = new WritableStream<Uint8Array>({ async write() { entered(); await blocked; }, close() { closed = true; } });
	const sink = await createMotionBrowserVideoSink({ plan, format: 'webm', writable }, fixture.host);
	const pending = sink.write(frame(0), controller.signal); await started;
	await assert.rejects(sink.write(frame(1)), /order/u);
	assert.equal(fixture.closed(), 1); assert.equal(fixture.timestamps.length, 1);
	controller.abort(new DOMException('Cancelled under backpressure', 'AbortError')); unblock();
	await assert.rejects(pending, /Cancelled/u); await sink.abort(controller.signal.reason);
	assert.equal(closed, false); assert.equal(writable.locked, false);
});
