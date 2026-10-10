/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withExportResizedPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-export-resize-v1.ts';

const limits = { maximumSidePixels: 65_536, maximumPixels: 33_554_432, maximumBytes: 134_217_728 };
const descriptor = (width: number, height: number) => ({ schemaVersion: 1, width, height,
	sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
const pixels = Uint8Array.of(0, 0, 0, 255, 200, 0, 0, 255, 0, 200, 0, 255, 200, 200, 0, 255);
const frame = { descriptor: descriptor(2, 2), pixels };
const request = (quality: string, percentage = 200) => ({ frame, quality, sizing: { kind: 'percentage', percentage } });

test('nearest and bilinear resizing pin different independent opaque rectangular goldens', async () => {
	for (const [quality, values] of [['nearest', [0, 0, 200, 200]], ['bilinear', [0, 50, 150, 200]]] as const) {
		const expected: number[] = [];
		for (const green of values) for (const red of values) expected.push(red, green, 0, 255);
		let borrowed: Uint8Array | undefined;
		await withExportResizedPixelFrameV1(request(quality), output => {
			assert.deepEqual(output.descriptor, descriptor(4, 4)); assert.deepEqual([...output.pixels], expected);
			borrowed = output.pixels; assert.notEqual(output.pixels.buffer, pixels.buffer);
		}, { limits });
		assert.equal(borrowed!.every(value => value === 0), true);
	}
	assert.deepEqual([...pixels], [0, 0, 0, 255, 200, 0, 0, 255, 0, 200, 0, 255, 200, 200, 0, 255]);
});

test('bilinear downsampling pins the center and premultiplied alpha without hidden-color bleed', async () => {
	await withExportResizedPixelFrameV1(request('bilinear', 50), output => {
		assert.deepEqual(output.descriptor, descriptor(1, 1)); assert.deepEqual([...output.pixels], [100, 100, 0, 255]);
	}, { limits });
	const source = { descriptor: descriptor(2, 1), pixels: Uint8Array.of(255, 0, 0, 0, 0, 0, 255, 255) };
	await withExportResizedPixelFrameV1({ frame: source, quality: 'bilinear', sizing: { kind: 'percentage', percentage: 200 } }, output => {
		const row = [0, 0, 0, 0, 0, 0, 255, 64, 0, 0, 255, 191, 0, 0, 255, 255];
		assert.deepEqual([...output.pixels], [...row, ...row]);
	}, { limits });
});

test('unchanged dimensions preserve hidden RGB exactly for both quality selections and offset buffers', async () => {
	const bytes = Uint8Array.of(71, 72, 255, 7, 9, 0, 11, 19, 83, 127, 73), before = bytes.slice();
	const source = { descriptor: descriptor(2, 1), pixels: new Uint8ClampedArray(bytes.buffer, 2, 8) };
	for (const quality of ['nearest', 'bilinear']) {
		await withExportResizedPixelFrameV1({ frame: source, quality, sizing: { kind: 'original' } }, output => {
			assert.deepEqual([...output.pixels], [255, 7, 9, 0, 11, 19, 83, 127]);
			assert.notEqual(output.pixels.buffer, bytes.buffer);
		}, { limits });
	}
	assert.deepEqual(bytes, before);
});

test('all sizing modes reach the scoped renderer without changing the developed source', async () => {
	for (const sizing of [{ kind: 'fit', width: 1, height: 1, allowUpscale: false },
		{ kind: 'long-edge', pixels: 1, allowUpscale: false }, { kind: 'megapixels', megapixels: 0.000_001, allowUpscale: false }]) {
		await withExportResizedPixelFrameV1({ frame, quality: 'bilinear', sizing }, output => {
			assert.deepEqual(output.descriptor, descriptor(1, 1)); assert.deepEqual([...output.pixels], [100, 100, 0, 255]);
		}, { limits });
	}
});

test('cancellation joins a held output consumer before wiping its borrowed frame', async () => {
	for (const quality of ['nearest', 'bilinear']) {
		let enter!: () => void, release!: () => void, settled = false, borrowed: Uint8Array | undefined;
		const entered = new Promise<void>(resolve => { enter = resolve; });
		const held = new Promise<void>(resolve => { release = resolve; });
		const stop = new AbortController(), reason = Symbol('resize consumer cancellation');
		const pending = withExportResizedPixelFrameV1({ ...request(quality), signal: stop.signal }, async output => {
			borrowed = output.pixels; enter(); await held;
		}, { limits }).finally(() => { settled = true; });
		await entered; stop.abort(reason); await Promise.resolve();
		assert.equal(settled, false); assert.equal(borrowed!.some(value => value !== 0), true);
		release(); await assert.rejects(pending, error => Object.is(error, reason));
		assert.equal(borrowed!.every(value => value === 0), true);
	}
});

test('failure identity, early cancellation and source detachment refuse delivery and preserve ownership', async () => {
	let borrowed: Uint8Array | undefined;
	const reason = Symbol('consumer refusal');
	await assert.rejects(withExportResizedPixelFrameV1(request('bilinear'), output => {
		borrowed = output.pixels; throw reason;
	}, { limits }), error => Object.is(error, reason));
	assert.equal(borrowed!.every(value => value === 0), true);
	const stop = new AbortController(); stop.abort(reason);
	await assert.rejects(withExportResizedPixelFrameV1({ ...request('nearest'), signal: stop.signal }, () => assert.fail('preabort delivery'), { limits }), error => Object.is(error, reason));
	const source = { descriptor: descriptor(2, 2), pixels: pixels.slice() };
	const pending = withExportResizedPixelFrameV1({ frame: source, quality: 'nearest', sizing: { kind: 'percentage', percentage: 200 } },
		() => assert.fail('detached delivery'), { limits });
	structuredClone(source.pixels.buffer, { transfer: [source.pixels.buffer] });
	await assert.rejects(pending, /detached/u);
});

test('closed requests, unsupported profiles and target capacity refuse before a consumer can observe output', async () => {
	const consume = () => assert.fail('invalid output');
	for (const invalid of [{ ...request('future') }, { ...request('nearest'), extra: 1 },
		{ ...request('nearest'), signal: { aborted: false } }, { ...request('nearest'), frame: { ...frame, pixels: new Uint8Array(15) } },
		{ ...request('nearest'), frame: { ...frame, descriptor: { ...frame.descriptor, primaries: 'display-p3' } } }]) {
		await assert.rejects(withExportResizedPixelFrameV1(invalid, consume, { limits }));
	}
	await assert.rejects(withExportResizedPixelFrameV1(request('nearest'), consume, { limits: { ...limits, maximumPixels: 15 } }), /pixel count/u);
});
