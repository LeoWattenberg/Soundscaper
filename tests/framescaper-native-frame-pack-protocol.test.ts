/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperNativeRgbaFramePackV1,
	streamFramescaperNativeRgbaFramePackV1,
	type FramescaperNativeRgbaFramePackV1Request,
} from '../src/framescaper/native-render-frame-pack-v1.ts';

function request(overrides: Partial<FramescaperNativeRgbaFramePackV1Request> = {}) {
	return {
		width: 2, height: 1, frameCount: 2, frameRate: { num: 30_000, den: 1_001 },
		signal: new AbortController().signal,
		assertCurrent() {},
		renderFrame(ordinal: number, output: Uint8Array) { output.fill(ordinal + 1); },
		...overrides,
	} satisfies FramescaperNativeRgbaFramePackV1Request;
}

test('collected carrier writes exact dimensions, cadence, ordinals and durations', async () => {
	const result = await createFramescaperNativeRgbaFramePackV1(request());
	const bytes = new Uint8Array(await result.bytes.arrayBuffer());
	const view = new DataView(bytes.buffer);
	assert.equal(new TextDecoder().decode(bytes.subarray(0, 31)), 'framescaper-rgba-frame-pack-v1\n');
	assert.equal(view.getUint32(31, true), 1);
	assert.equal(view.getUint32(35, true), 2);
	assert.equal(view.getUint32(39, true), 1);
	assert.equal(view.getBigUint64(43, true), 2n);
	assert.deepEqual([view.getUint32(51, true), view.getUint32(55, true)], [1_001, 30_000]);
	for (const ordinal of [0, 1]) {
		const offset = 59 + ordinal * 40;
		assert.equal(view.getBigUint64(offset, true), BigInt(ordinal));
		assert.equal(view.getBigInt64(offset + 8, true), BigInt(ordinal));
		assert.equal(view.getBigInt64(offset + 16, true), 1n);
		assert.equal(view.getBigUint64(offset + 24, true), 8n);
		assert.deepEqual(bytes.subarray(offset + 32, offset + 40), new Uint8Array(8).fill(ordinal + 1));
	}
	assert.equal(result.byteLength, 139);
	assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
});

test('the renderer receives zeroed pixels for each frame after its predecessor', async () => {
	const result = await createFramescaperNativeRgbaFramePackV1(request({
		renderFrame(ordinal, output) {
			if (ordinal === 0) output.fill(9);
			else output[0] = 7;
		},
	}));
	const bytes = new Uint8Array(await result.bytes.arrayBuffer());
	assert.deepEqual(bytes.subarray(59 + 40 + 32), Uint8Array.of(7, 0, 0, 0, 0, 0, 0, 0));
});

test('direct streaming matches the collected canonical bytes and digest at small chunks', async () => {
	const expected = await createFramescaperNativeRgbaFramePackV1(request({ maximumChunkBytes: 32 }));
	const chunks: Uint8Array[] = [];
	const streamed = await streamFramescaperNativeRgbaFramePackV1(
		request({ maximumChunkBytes: 32 }),
		{ write(bytes) { chunks.push(Uint8Array.from(bytes)); } },
	);
	const bytes = new Uint8Array(chunks.flatMap((chunk) => [...chunk]));
	assert.ok(chunks.every(({ byteLength }) => byteLength <= 32));
	assert.deepEqual(bytes, new Uint8Array(await expected.bytes.arrayBuffer()));
	assert.equal(streamed.byteLength, expected.byteLength);
	assert.equal(streamed.sha256, expected.sha256);
	assert.equal(streamed.chunkCount, chunks.length);
});

test('an already aborted frame pack does not allocate a collector', async () => {
	const controller = new AbortController();
	controller.abort(new Error('cancelled before allocation'));
	let allocations = 0;
	await assert.rejects(() => createFramescaperNativeRgbaFramePackV1(request({
		signal: controller.signal,
		createCollector() { allocations += 1; throw new Error('collector allocated'); },
	})), /cancelled before allocation/u);
	assert.equal(allocations, 0);
});

test('a stale frame pack does not allocate a collector', async () => {
	let allocations = 0;
	await assert.rejects(() => createFramescaperNativeRgbaFramePackV1(request({
		assertCurrent() { throw new Error('stale before allocation'); },
		createCollector() { allocations += 1; throw new Error('collector allocated'); },
	})), /stale before allocation/u);
	assert.equal(allocations, 0);
});

test('a render failure clears the collector and preserves the renderer error', async () => {
	const failure = new Error('renderer failed');
	let clears = 0;
	let appends = 0;
	await assert.rejects(() => createFramescaperNativeRgbaFramePackV1(request({
		frameCount: 1,
		renderFrame() { throw failure; },
		createCollector() { return {
			append() { appends += 1; },
			complete() { throw new Error('unexpected complete'); },
			clear() { clears += 1; },
		}; },
	})), (error: unknown) => error === failure);
	assert.equal(appends, 1, 'only the file header may have been appended');
	assert.equal(clears, 1);
});

test('a collector with inconsistent completed length is cleared', async () => {
	let clears = 0;
	await assert.rejects(() => createFramescaperNativeRgbaFramePackV1(request({
		frameCount: 1,
		createCollector() { return {
			append() {},
			complete() { return { bytes: new Blob([]), byteLength: 0, sha256: '0'.repeat(64), chunkCount: 0 }; },
			clear() { clears += 1; },
		}; },
	})), /inconsistent byte length/iu);
	assert.equal(clears, 1);
});

test('a sink failure stops streaming before a frame can be rendered', async () => {
	const failure = new Error('sink refused header');
	let renders = 0;
	await assert.rejects(() => streamFramescaperNativeRgbaFramePackV1(request({
		renderFrame() { renders += 1; },
	}), { write() { throw failure; } }), (error: unknown) => error === failure);
	assert.equal(renders, 0);
});

test('abort after rendering prevents writing that frame or rendering another', async () => {
	const controller = new AbortController();
	let renders = 0;
	const parts: Uint8Array[] = [];
	await assert.rejects(() => streamFramescaperNativeRgbaFramePackV1(request({
		signal: controller.signal,
		renderFrame(_ordinal, output) {
			renders += 1;
			output.fill(9);
			controller.abort(new Error('cancelled after render'));
		},
	}), { write(bytes) { parts.push(Uint8Array.from(bytes)); } }), /cancelled after render/u);
	assert.equal(renders, 1);
	assert.equal(parts.reduce((sum, part) => sum + part.byteLength, 0), 59);
});
