/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionAeRenderStream } from '../src/motionscaper/editor-ae-render-stream.ts';
import { motionTarFileHeader, motionTarPadding } from '../src/common/editor/motion-tar.ts';
import type { MotionRenderPlan } from '../src/common/editor/controller/export/motion-render-pipeline.ts';
const plan: MotionRenderPlan = { identity: { projectId: 'source', revisionDigest: 'a'.repeat(64), compositionId: 'comp' }, width: 4, height: 4, frameRate: { num: 30000, den: 1001 }, firstFrame: 0, frameCount: 2, depthOfFieldSamples: 4 };
const png = () => { const bytes = new Uint8Array(33); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); const view = new DataView(bytes.buffer); view.setUint32(8, 13); view.setUint32(12, 0x49484452); view.setUint32(16, 4); view.setUint32(20, 4); bytes[24] = 8; bytes[25] = 6; return bytes; };
const entry = (name: string, bytes: Uint8Array) => [motionTarFileHeader(name, bytes.length), bytes, motionTarPadding(bytes.length)];
const metadata = (overrides = {}) => new TextEncoder().encode(JSON.stringify({ format: 'motionscaper-png-sequence', version: 1, ...plan, colorSpace: 'srgb', alphaMode: 'straight', pattern: 'frames/frame%012d.png', ...overrides }));
const sequence = (sidecar = metadata()) => [...entry('frames/frame000000000001.png', png()), ...entry('frames/frame000000000002.png', png()), ...entry('sequence.json', sidecar), new Uint8Array(1024)];
const concatenate = (chunks: Uint8Array[]) => { const bytes = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0)); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } return bytes; };
test('Motion AE streaming fallback accepts split chunks, exact pinned quality and backpressured complete frames', async () => {
	const frames: number[] = []; let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
	const stream = createMotionAeRenderStream({ plan, maximumBytes: 8192, onFrame: async (index, bytes) => { frames.push(index); assert.deepEqual(bytes, png()); if (index === 0) await blocked; } });
	const writer = stream.writable.getWriter(), bytes = concatenate(sequence()); let done = false;
	const first = writer.write(bytes.slice(0, 1024)).then(() => { done = true; }); await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(done, false); assert.deepEqual(frames, [0]); release(); await first;
	for (let at = 1024; at < bytes.length; at += 137) await writer.write(bytes.slice(at, at + 137));
	assert.throws(() => stream.assertComplete(), /complete/iu); await writer.close(); stream.assertComplete(); assert.deepEqual(frames, [0, 1]);
});
test('Motion AE streaming fallback refuses missing, duplicated, reordered, truncated and noncanonical sequence entries', async () => {
	const valid = sequence();
	for (const chunks of [valid.slice(3), [...valid.slice(0, 3), ...valid], valid.slice(0, -1), [...valid, new Uint8Array(1)], [...entry('frames/frame000000000002.png', png()), ...valid]]) {
		const stream = createMotionAeRenderStream({ plan, maximumBytes: 8192, onFrame: async () => {} }), writer = stream.writable.getWriter();
		await assert.rejects(async () => { for (const bytes of chunks) await writer.write(bytes); await writer.close(); }); assert.throws(() => stream.assertComplete(), /complete/iu);
	}
	const bad = concatenate(valid); bad[100] ^= 1;
	const stream = createMotionAeRenderStream({ plan, maximumBytes: 8192, onFrame: async () => {} }); await assert.rejects(stream.writable.getWriter().write(bad), /canonical/iu);
});
test('Motion AE streaming fallback refuses stale revision, missing quality, forged color and wrong dimensions', async () => {
	for (const sidecar of [metadata({ identity: { ...plan.identity, revisionDigest: 'b'.repeat(64) } }), metadata({ depthOfFieldSamples: 1 }), metadata({ colorSpace: 'rec709' })]) {
		const stream = createMotionAeRenderStream({ plan, maximumBytes: 8192, onFrame: async () => {} }); await assert.rejects(stream.writable.getWriter().write(concatenate(sequence(sidecar))), /pinned/iu);
	}
	const bytes = png(); bytes[19] = 8;
	const stream = createMotionAeRenderStream({ plan, maximumBytes: 8192, onFrame: async () => {} }); await assert.rejects(stream.writable.getWriter().write(concatenate(entry('frames/frame000000000001.png', bytes))), /PNG/iu);
});
test('Motion AE streaming fallback bounds allocation, aggregate bytes and cancellation before frame consumption', async () => {
	let calls = 0; const onFrame = async () => { calls++; };
	let stream = createMotionAeRenderStream({ plan, maximumBytes: 8192, onFrame });
	await assert.rejects(stream.writable.getWriter().write(motionTarFileHeader('frames/frame000000000001.png', 64 * 1024 * 1024 + 1)), /bound/iu);
	stream = createMotionAeRenderStream({ plan, maximumBytes: 512, onFrame }); await assert.rejects(stream.writable.getWriter().write(concatenate(sequence())), /bound/iu);
	const abort = new AbortController(); stream = createMotionAeRenderStream({ plan, maximumBytes: 8192, onFrame, signal: abort.signal }); abort.abort(); await assert.rejects(stream.writable.getWriter().write(new Uint8Array(1)), { name: 'AbortError' }); assert.equal(calls, 0);
});
