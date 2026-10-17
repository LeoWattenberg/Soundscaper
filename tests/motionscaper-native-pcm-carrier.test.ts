/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createMotionNativePcmWriter, openMotionNativePcmReader, motionNativePcmPlan } from '../src/common/editor/motion-native-pcm-carrier-v1.ts';
import { createScapeArchiveByteSource } from '../src/common/editor/scape-archive-byte-source.ts';
import { addRationals, divideRationals, multiplyRationals } from '../src/common/editor/timeline-time.ts';
const frames = { identity: { projectId: 'p', compositionId: 'c', revisionDigest: 'a'.repeat(64) }, width: 32, height: 16,
	frameRate: { num: 30000, den: 1001 }, firstFrame: 123, frameCount: 3 };
const plan = motionNativePcmPlan(frames, { sampleRate: 48000, channels: 2 });
function block(offset: number, count: number) {
	return { ...frames.identity, revision: 1, startSample: addRationals(multiplyRationals(divideRationals(frames.firstFrame, frames.frameRate), plan.sampleRate), offset),
		sampleCount: count, sampleRate: plan.sampleRate, channels: plan.channels,
		interleaved: Float32Array.from({ length: count * plan.channels }, (_, index) => index % 2 ? -0.1234567 : 1.234567) };
}
function output() { const chunks: Uint8Array[] = []; return { chunks, stream: new WritableStream<Uint8Array>({ write(bytes) { chunks.push(bytes.slice()); } }), bytes: () => Buffer.concat(chunks) }; }
function source(bytes: Uint8Array) { return createScapeArchiveByteSource({ size: bytes.length, maximumReadBytes: 71, read: ({ offset, length }) => bytes.slice(offset, offset + length) }); }
test('native PCM v1 preserves floating mix precision, fractional range start and exact cumulative sample duration', async () => {
	assert.equal(plan.sampleCount, 4805);
	const target = output(); const writer = await createMotionNativePcmWriter(plan, target.stream);
	await writer.write(block(0, 1602)); await writer.write(block(1602, 3203));
	const receipt = await writer.finish();
	assert.deepEqual(receipt, { sampleCount: 4805, byteLength: target.bytes().length, sha256: createHash('sha256').update(target.bytes()).digest('hex') });
	const reader = await openMotionNativePcmReader(source(target.bytes()), plan);
	assert.deepEqual(await reader.read(0), block(0, 4096).interleaved);
	assert.deepEqual(await reader.read(4096), block(4096, 709).interleaved);
	await assert.rejects(reader.read(4805), /sequential/iu);
	assert.ok(target.chunks.every(bytes => bytes.length <= 65536));
});
test('native PCM admission rejects stale blocks, incomplete data, nonfinite samples and duration-sized indexes', async () => {
	assert.throws(() => motionNativePcmPlan({ ...frames, frameCount: 100000 }, { sampleRate: 192000, channels: 2 }), /sample index/iu);
	const target = output(); const writer = await createMotionNativePcmWriter(plan, target.stream);
	await assert.rejects(writer.write({ ...block(0, 1), revisionDigest: 'b'.repeat(64) }), /pinned/iu);
	await assert.rejects(writer.write(block(1, 1)), /sequential/iu);
	await assert.rejects(writer.write({ ...block(0, 1), interleaved: new Float32Array([NaN, 0]) }), /finite/iu);
	await assert.rejects(writer.finish(), /incomplete/iu);
	await writer.abort('cancel');
	const valid = output(); const ready = await createMotionNativePcmWriter(plan, valid.stream);
	await ready.write(block(0, plan.sampleCount)); await ready.finish();
	await assert.rejects(openMotionNativePcmReader(source(valid.bytes().subarray(1)), plan), /magic/iu);
	await assert.rejects(openMotionNativePcmReader(source(valid.bytes().subarray(0, valid.bytes().length - 1)), plan), /length/iu);
	await assert.rejects(openMotionNativePcmReader(source(valid.bytes()), { ...plan, channels: 1 }), /plan/iu);
});
