/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { createMotionNativeFrameWriter, openMotionNativeFrameReader, MOTION_NATIVE_FRAME_CHUNK_BYTES } from '../src/common/editor/motion-native-frame-carrier-v1.ts';

const plan = { identity: { projectId: 'p', compositionId: 'c', revisionDigest: 'a'.repeat(64) }, width: 2, height: 1,
	frameRate: { num: 30_000, den: 1001 }, firstFrame: 123, frameCount: 2 };
function sink() {
	const chunks: Uint8Array[] = [];
	return { chunks, writable: new WritableStream<Uint8Array>({ write(chunk) { chunks.push(chunk.slice()); } }),
		bytes() { return Buffer.concat(chunks); } };
}
function source(bytes: Uint8Array) {
	return createScapeArchiveByteSource({ size: bytes.length, maximumReadBytes: 37,
		read: ({ offset, length }) => bytes.slice(offset, offset + length) });
}

test('native motion carrier preserves float precision, alpha and exact pinned cadence without RGBA8 quantization', async () => {
	const output = sink(); const writer = await createMotionNativeFrameWriter(plan, output.writable);
	const frame = createMotionSurface(2, 1);
	frame.pixels.set([0.1234567, 0.0123456, 0.0034567, 0.2345678, 0, 0, 0, 0]);
	await writer.write(0, frame); await writer.write(1, frame); const receipt = await writer.finish();
	assert.deepEqual(receipt, { byteLength: output.bytes().length, frameCount: 2, sha256: createHash('sha256').update(output.bytes()).digest('hex') });
	const reader = await openMotionNativeFrameReader(source(output.bytes()), plan.identity);
	assert.deepEqual(reader.header, { ...plan, format: 'motionscaper-linear-rgba-frame-pack', version: 1,
		pixelFormat: 'rgba-f32le', colorSpace: 'linear-rec709-d65', alphaMode: 'premultiplied' });
	assert.deepEqual((await reader.read(0)).pixels, frame.pixels);
	assert.deepEqual((await reader.read(1)).pixels, frame.pixels);
	await assert.rejects(reader.read(2), /sequential/iu);
	await assert.rejects(openMotionNativeFrameReader(source(output.bytes()), { ...plan.identity, revisionDigest: 'b'.repeat(64) }), /identity/iu);
});

test('native motion carrier rejects malformed cadence, incomplete frames and poisoned pixel values', async () => {
	const output = sink(); const writer = await createMotionNativeFrameWriter(plan, output.writable);
	await assert.rejects(writer.write(1, createMotionSurface(2, 1)), /sequential/iu);
	await assert.rejects(writer.finish(), /incomplete/iu);
	await writer.abort('cancel');
	const ready = sink(); const valid = await createMotionNativeFrameWriter({ ...plan, frameCount: 1 }, ready.writable);
	await valid.write(0, createMotionSurface(2, 1)); await valid.finish();
	const bytes = ready.bytes();
	await assert.rejects(openMotionNativeFrameReader(source(bytes.subarray(0, bytes.length - 1)), plan.identity), /length/iu);
	const poisoned = Buffer.from(bytes); poisoned.writeFloatLE(Number.NaN, poisoned.length - 64);
	const reader = await openMotionNativeFrameReader(source(poisoned), plan.identity);
	await assert.rejects(reader.read(0), /pixel/iu);
	const legacy = Buffer.from(bytes); legacy[0] = 0;
	await assert.rejects(openMotionNativeFrameReader(source(legacy), plan.identity), /magic/iu);
	await assert.rejects(createMotionNativeFrameWriter({ ...plan, frameRate: { num: 0, den: 1 } }, sink().writable), /positive/iu);
});

test('native motion carrier bounds encoding chunks and cancellation aborts incomplete output', async () => {
	const output = sink(); const large = { ...plan, width: 1024, height: 257, frameCount: 1 };
	const writer = await createMotionNativeFrameWriter(large, output.writable);
	await writer.write(0, createMotionSurface(large.width, large.height, [0.3, 0.2, 0.1, 0.75])); await writer.finish();
	assert.ok(output.chunks.every((chunk) => chunk.byteLength <= MOTION_NATIVE_FRAME_CHUNK_BYTES));
	let aborted = false; const signal = new AbortController();
	const cancelled = await createMotionNativeFrameWriter(plan, new WritableStream({ abort() { aborted = true; } }), signal.signal);
	signal.abort(); await assert.rejects(cancelled.write(0, createMotionSurface(2, 1)), /abort/iu);
	assert.equal(aborted, true);
});
