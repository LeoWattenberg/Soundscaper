/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionSurface, motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
import { encodeMotionPng } from '../src/common/editor/motion-png.ts';
import { createMotionPngSequenceSink } from '../src/common/editor/controller/export/motion-png-sequence.ts';
import { type MotionRenderFrame, type MotionRenderPlan } from '../src/common/editor/controller/export/motion-render-pipeline.ts';

const kit = await CanvasKitInit();
const plan: MotionRenderPlan = { identity: { projectId: 'motion-1', compositionId: 'comp-1', revisionDigest: 'a'.repeat(64) },
	width: 2, height: 2, firstFrame: 0, frameCount: 2, frameRate: { num: 30, den: 1 } };
function frame(index: number): MotionRenderFrame {
	const surface = createMotionSurface(2, 2, [0.5, 0.25, 0.125, 0.5]);
	surface.pixels.set([0, 0, 0, 0], 0);
	return { index, time: { num: index, den: 30 }, duration: { num: 1, den: 30 }, surface: { ...surface, consumedOperationIds: [] } };
}
function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
	let resolve!: () => void;
	const promise = new Promise<void>((accept) => { resolve = accept; });
	return { promise, resolve };
}
function tarEntries(bytes: Uint8Array): ReadonlyMap<string, Uint8Array> {
	const entries = new Map<string, Uint8Array>(); const text = new TextDecoder();
	for (let offset = 0; offset + 512 <= bytes.byteLength;) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = text.decode(header.subarray(0, 100)).replace(/\0.*$/u, '');
		const size = Number.parseInt(text.decode(header.subarray(124, 136)).replace(/\0.*$/u, '').trim(), 8);
		const checksum = Number.parseInt(text.decode(header.subarray(148, 156)).replace(/\0.*$/u, '').trim(), 8);
		assert.equal(checksum, header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0));
		assert.equal(text.decode(header.subarray(257, 263)), 'ustar\0');
		entries.set(name, bytes.slice(offset + 512, offset + 512 + size));
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return entries;
}

test('M05 real PNG encoding preserves straight sRGB colors and transparent pixels', () => {
	const surface = frame(0).surface;
	const encoded = encodeMotionPng(kit, surface);
	assert.deepEqual([...encoded.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const decoded = kit.MakeImageFromEncoded(encoded);
	assert.ok(decoded);
	try {
		const rgba = decoded.readPixels(0, 0, { width: 2, height: 2, colorType: kit.ColorType.RGBA_8888,
			alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB });
		assert.ok(rgba instanceof Uint8Array);
		const expected = motionSurfaceToRgba8(surface, 'srgb');
		assert.deepEqual([...rgba.subarray(0, 4)], [0, 0, 0, 0]);
		assert.ok([...rgba].every((value, index) => Math.abs(value - expected[index]!) <= 1));
	} finally { decoded.delete(); }
});

test('M05 transparent PNG sequences contain ordered normal images and exact revision metadata', async () => {
	const sink = createMotionPngSequenceSink({ plan, encode: async (surface) => encodeMotionPng(kit, surface) });
	await sink.write(frame(0)); await sink.write(frame(1));
	const blob = await sink.finish();
	assert.ok(blob instanceof Blob);
	const entries = tarEntries(new Uint8Array(await blob.arrayBuffer()));
	assert.deepEqual([...entries.keys()], ['frames/frame000000000001.png', 'frames/frame000000000002.png', 'sequence.json']);
	const metadata: unknown = JSON.parse(new TextDecoder().decode(entries.get('sequence.json')));
	assert.deepEqual(metadata, { format: 'motionscaper-png-sequence', version: 1, ...plan,
		colorSpace: 'srgb', alphaMode: 'straight', pattern: 'frames/frame%012d.png' });
	const decoded = kit.MakeImageFromEncoded(entries.get('frames/frame000000000001.png')!);
	assert.ok(decoded); decoded.delete();
});

test('M05 streamed sequences backpressure and commit only after the declared complete frame count', async () => {
	const chunks: Uint8Array[] = []; const events: string[] = [];
	const writable = new WritableStream<Uint8Array>({ write(chunk) { chunks.push(new Uint8Array(chunk)); }, close() { events.push('close'); } });
	const sink = createMotionPngSequenceSink({ plan, writable, encode: async (surface) => encodeMotionPng(kit, surface) });
	await sink.write(frame(0));
	await assert.rejects(sink.finish(), /complete/u);
	assert.deepEqual(events, []);
	await sink.write(frame(1));
	assert.equal(await sink.finish(), null);
	assert.deepEqual(events, ['close']);
	assert.ok(chunks.every((chunk) => chunk.byteLength <= 4 * 1024 * 1024));
});

test('M05 sequence abort, wrong frame order and Blob admission leave no completed output', async () => {
	const reasons: unknown[] = [];
	const writable = new WritableStream<Uint8Array>({ abort(reason: unknown) { reasons.push(reason); } });
	const sink = createMotionPngSequenceSink({ plan, writable, encode: async () => new Uint8Array([137]) });
	await assert.rejects(sink.write(frame(1)), /order/u);
	const reason = new DOMException('User cancelled', 'AbortError');
	await sink.abort(reason); await sink.abort(reason);
	assert.deepEqual(reasons, [reason]);
	await assert.rejects(sink.finish(), /closed/u);
	const bounded = createMotionPngSequenceSink({ plan, maximumBlobBytes: 512, encode: async (surface) => encodeMotionPng(kit, surface) });
	await assert.rejects(bounded.write(frame(0)), /Blob.*admission/u);
	await bounded.abort(reason);
});

test('M05 PNG encoding waits for destination backpressure and rejects overlapping frames', async () => {
	const blocked = deferred();
	const entered = deferred();
	let encoded = 0;
	const writable = new WritableStream<Uint8Array>({ async write() { entered.resolve(); await blocked.promise; } });
	const sink = createMotionPngSequenceSink({ plan, writable, encode: async (surface) => { encoded += 1; return encodeMotionPng(kit, surface); } });
	const pending = sink.write(frame(0));
	await entered.promise;
	await assert.rejects(sink.write(frame(1)), /order/u);
	await assert.rejects(sink.finish(), /complete/u);
	assert.equal(encoded, 1);
	blocked.resolve(); await pending;
	await sink.write(frame(1)); await sink.finish();
	assert.equal(encoded, 2);
});

test('M05 destination failure and malformed PNG dimensions cannot publish a completed archive', async () => {
	let closed = false;
	const diskFailure = new Error('Destination is full');
	const writable = new WritableStream<Uint8Array>({ write() { throw diskFailure; }, close() { closed = true; } });
	const sink = createMotionPngSequenceSink({ plan, writable, encode: async (surface) => encodeMotionPng(kit, surface) });
	await assert.rejects(sink.write(frame(0)), (error: unknown) => error === diskFailure);
	await sink.abort(diskFailure);
	assert.equal(closed, false);
	assert.equal(writable.locked, false);
	const malformed = createMotionPngSequenceSink({ plan, encode: async () => encodeMotionPng(kit, createMotionSurface(1, 1)) });
	await assert.rejects(malformed.write(frame(0)), /dimensions/u);
	await malformed.abort(diskFailure);
	await assert.rejects(malformed.finish(), /closed/u);
});
