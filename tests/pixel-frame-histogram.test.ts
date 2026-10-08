/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createPixelFrameHistogramV1 } from '../src/common/editor/imaging/pixel-frame-histogram-v1.ts';

const LIMITS = { maximumSidePixels: 1024, maximumPixels: 1024 * 1024, maximumBytes: 4 * 1024 * 1024 };
function frame(bytes: readonly number[]) {
	return { descriptor: { schemaVersion: 1, width: bytes.length / 4, height: 1,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(bytes) };
}
function occupied(bins: readonly number[]) {
	return bins.flatMap((count, sample) => count ? [[sample, count]] : []);
}

test('RGB histogram pins visible encoded samples and independent clipping counts', async () => {
	const source = frame([0, 20, 255, 255, 255, 0, 128, 1, 64, 64, 64, 128, 255, 0, 0, 0]);
	const before = Array.from(source.pixels);
	const result = await createPixelFrameHistogramV1(source, { limits: LIMITS });
	assert.equal(result.schemaVersion, 1);
	assert.equal(result.sampledPixels, 3); assert.equal(result.transparentPixels, 1);
	assert.deepEqual(occupied(result.bins.red), [[0, 1], [64, 1], [255, 1]]);
	assert.deepEqual(occupied(result.bins.green), [[0, 1], [20, 1], [64, 1]]);
	assert.deepEqual(occupied(result.bins.blue), [[64, 1], [128, 1], [255, 1]]);
	assert.deepEqual(result.lowClippedChannels, [1, 1, 0]);
	assert.deepEqual(result.highClippedChannels, [1, 0, 1]);
	assert.equal(result.lowClippedPixels, 2); assert.equal(result.highClippedPixels, 2);
	assert.deepEqual(Array.from(source.pixels), before);
	assert.deepEqual(await createPixelFrameHistogramV1(source, { limits: LIMITS }), result);
});

test('transparent hidden RGB contributes no samples, including hidden clipping', async () => {
	const result = await createPixelFrameHistogramV1(frame([255, 0, 255, 0, 0, 255, 0, 0]), { limits: LIMITS });
	assert.equal(result.sampledPixels, 0); assert.equal(result.transparentPixels, 2);
	for (const bins of Object.values(result.bins)) {
		assert.equal(bins.length, 256); assert.deepEqual(occupied(bins), []);
	}
	assert.deepEqual(result.lowClippedChannels, [0, 0, 0]);
	assert.deepEqual(result.highClippedChannels, [0, 0, 0]);
	assert.equal(result.lowClippedPixels, 0); assert.equal(result.highClippedPixels, 0);
});

test('histogram owns immutable bounded counts and borrows a nonzero-offset source without writes', async () => {
	const raw = new Uint8Array([17, 0, 0, 0, 255, 255, 255, 255, 255, 29]);
	const source = { ...frame([0, 0, 0, 255, 255, 255, 255, 255]), pixels: raw.subarray(1, 9) };
	const result = await createPixelFrameHistogramV1(source, { limits: LIMITS });
	assert.equal(result.sampledPixels, 2);
	assert.equal(result.lowClippedPixels, 1); assert.equal(result.highClippedPixels, 1);
	assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.bins), true);
	for (const bins of Object.values(result.bins)) assert.equal(Object.isFrozen(bins), true);
	assert.equal(Object.isFrozen(result.lowClippedChannels), true);
	assert.equal(Object.isFrozen(result.highClippedChannels), true);
	assert.deepEqual(Array.from(raw), [17, 0, 0, 0, 255, 255, 255, 255, 255, 29]);
	source.pixels.fill(42);
	assert.equal(result.bins.red[0], 1); assert.equal(result.bins.red[255], 1);
});

test('histogram refuses undeveloped linear, wider, deeper, mismatched and over-budget samples', async () => {
	for (const patch of [{ transfer: 'linear' }, { primaries: 'display-p3' }, { sampleFormat: 'unorm16' }, { sampleFormat: 'float32' }]) {
		const source = frame([1, 2, 3, 255]);
		await assert.rejects(createPixelFrameHistogramV1({ ...source, descriptor: { ...source.descriptor, ...patch } }, { limits: LIMITS }), /not admitted/u);
	}
	await assert.rejects(createPixelFrameHistogramV1({ ...frame([1, 2, 3, 255]), pixels: new Uint8Array(3) }, { limits: LIMITS }), /geometry/u);
	await assert.rejects(createPixelFrameHistogramV1(frame([1, 2, 3, 255, 4, 5, 6, 255]),
		{ limits: { ...LIMITS, maximumBytes: 4 } }), /byte length/u);
});

test('pre-cancellation retains opaque native reason without admitting or reflecting on the frame', async () => {
	const controller = new AbortController();
	let reasonProbes = 0, frameProbes = 0;
	const reason = new Proxy({}, { getOwnPropertyDescriptor() { reasonProbes++; throw new Error('Reason reflected.'); },
		get() { reasonProbes++; throw new Error('Reason inspected.'); } });
	const source = new Proxy({}, { getOwnPropertyDescriptor() { frameProbes++; throw new Error('Frame inspected.'); },
		get() { frameProbes++; throw new Error('Frame inspected.'); } });
	controller.abort(reason);
	const observed = await createPixelFrameHistogramV1(source, { limits: LIMITS, signal: controller.signal })
		.then(() => ({ rejected: false, reason: undefined }), error => ({ rejected: true, reason: error as unknown }));
	assert.equal(observed.rejected, true); assert.equal(observed.reason, reason);
	assert.equal(reasonProbes, 0); assert.equal(frameProbes, 0);
});

test('bounded histogram yields to real-task cancellation and never publishes partial counts', async () => {
	const controller = new AbortController(), reason = new Error('Histogram cancelled.');
	const source = { ...frame([128, 128, 128, 255]),
		descriptor: { ...frame([128, 128, 128, 255]).descriptor, width: 512, height: 512 }, pixels: new Uint8Array(512 * 512 * 4).fill(128) };
	let delivered = false;
	const handle = setTimeout(() => { controller.abort(reason); }, 0);
	try {
		await assert.rejects(createPixelFrameHistogramV1(source, { limits: LIMITS, signal: controller.signal }).then(result => {
			delivered = true; return result;
		}), error => error === reason);
	} finally { clearTimeout(handle); }
	assert.equal(delivered, false); assert.equal(source.pixels.every(value => value === 128), true);
});

test('native transfer during a yielded histogram refuses invalid partial counts', async () => {
	const source = { ...frame([128, 128, 128, 255]),
		descriptor: { ...frame([128, 128, 128, 255]).descriptor, width: 512, height: 512 }, pixels: new Uint8Array(512 * 512 * 4).fill(128) };
	const handle = setTimeout(() => { structuredClone(source.pixels.buffer, { transfer: [source.pixels.buffer] }); }, 0);
	try { await assert.rejects(createPixelFrameHistogramV1(source, { limits: LIMITS }), /detached/u); }
	finally { clearTimeout(handle); }
	assert.equal(source.pixels.byteLength, 0);
});

test('closed histogram request rejects accessors without invoking them and rejects signal impostors', async () => {
	let invoked = 0;
	await assert.rejects(createPixelFrameHistogramV1(frame([1, 2, 3, 255]), {
		get limits() { invoked++; return LIMITS; },
	}), /data property/u);
	assert.equal(invoked, 0);
	await assert.rejects(createPixelFrameHistogramV1(frame([1, 2, 3, 255]), { limits: LIMITS, signal: {} }), /native cancellation signal/u);
});
