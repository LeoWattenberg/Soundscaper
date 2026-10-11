/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { motionVideoFrameTimestamp, motionVideoPixels, normalizeMotionVideoDelivery } from '../src/common/editor/motion-video-delivery.ts';
import { createMotionBrowserVideoSink, type MotionVideoHost } from '../src/common/editor/controller/export/motion-browser-video.ts';
import type { MotionRenderFrame, MotionRenderPlan } from '../src/common/editor/controller/export/motion-render-pipeline.ts';

const plan: MotionRenderPlan = { identity: { projectId: 'motion', compositionId: 'comp', revisionDigest: 'a'.repeat(64) },
	width: 2, height: 2, frameRate: { num: 30000, den: 1001 }, firstFrame: 100, frameCount: 2 };
const frame = (index: number): MotionRenderFrame => ({ index, time: { num: (100 + index) * 1001, den: 30000 }, duration: { num: 1001, den: 30000 },
	surface: { ...createMotionSurface(2, 2, [1, 0.5, 0, 0.5]), consumedOperationIds: [] } });
function createFixture() {
	const events: string[] = []; const timestamps: number[] = []; let frameClosed = 0; let writable: WritableStream<Uint8Array> | undefined;
	const host: MotionVideoHost = {
		async supported() { return true; },
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
