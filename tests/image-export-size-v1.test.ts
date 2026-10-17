/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planImageExportSizeV1 } from '../src/common/editor/imaging/image-export-size-v1.ts';

const descriptor = (width: number, height: number) => ({ schemaVersion: 1, width, height,
	sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
const size = (width: number, height: number, sizing: unknown) => planImageExportSizeV1(descriptor(width, height), sizing).target;

test('original export size retains the exact descriptor without borrowing its mutable object', () => {
	const input = descriptor(4_000, 3_000), plan = planImageExportSizeV1(input, { kind: 'original' });
	assert.deepEqual(plan.source, input); assert.deepEqual(plan.target, input);
	assert.equal(plan.pixelCount, 12_000_000);
	assert.equal(Object.isFrozen(plan), true); assert.equal(Object.isFrozen(plan.target), true);
	input.width = 1;
	assert.equal(plan.source.width, 4_000); assert.equal(plan.target.width, 4_000);
});

test('fit and long-edge preserve aspect with rounded integer dimensions and explicit upscaling', () => {
	assert.deepEqual(size(4_000, 3_000, { kind: 'fit', width: 1_000, height: 1_000, allowUpscale: false }), descriptor(1_000, 750));
	assert.deepEqual(size(3_000, 4_000, { kind: 'fit', width: 1_000, height: 500, allowUpscale: false }), descriptor(375, 500));
	assert.deepEqual(size(3, 2, { kind: 'fit', width: 9, height: 9, allowUpscale: false }), descriptor(3, 2));
	assert.deepEqual(size(3, 2, { kind: 'fit', width: 9, height: 9, allowUpscale: true }), descriptor(9, 6));
	assert.deepEqual(size(3, 2, { kind: 'long-edge', pixels: 10, allowUpscale: true }), descriptor(10, 7));
	assert.deepEqual(size(2, 3, { kind: 'long-edge', pixels: 2, allowUpscale: false }), descriptor(1, 2));
	assert.deepEqual(size(65_536, 1, { kind: 'fit', width: 1, height: 1, allowUpscale: false }), descriptor(1, 1));
});

test('megapixels are a conservative maximum even for extreme aspect ratios and single pixels', () => {
	assert.deepEqual(size(4_000, 3_000, { kind: 'megapixels', megapixels: 1, allowUpscale: false }), descriptor(1_154, 866));
	assert.deepEqual(size(3_000, 4_000, { kind: 'megapixels', megapixels: 1, allowUpscale: false }), descriptor(866, 1_154));
	assert.deepEqual(size(65_536, 1, { kind: 'megapixels', megapixels: 0.000_001, allowUpscale: false }), descriptor(1, 1));
	assert.deepEqual(size(1, 65_536, { kind: 'megapixels', megapixels: 0.000_001, allowUpscale: false }), descriptor(1, 1));
	assert.deepEqual(size(2, 2, { kind: 'megapixels', megapixels: 0.000_025, allowUpscale: false }), descriptor(2, 2));
	assert.deepEqual(size(2, 2, { kind: 'megapixels', megapixels: 0.000_025, allowUpscale: true }), descriptor(5, 5));
});

test('percentage is an explicit resize ratio, with rounded dimensions and a one-pixel minimum', () => {
	assert.deepEqual(size(7, 3, { kind: 'percentage', percentage: 50 }), descriptor(4, 2));
	assert.deepEqual(size(7, 3, { kind: 'percentage', percentage: 200 }), descriptor(14, 6));
	assert.deepEqual(size(2, 3, { kind: 'percentage', percentage: 0.001 }), descriptor(1, 1));
	assert.deepEqual(size(2, 3, { kind: 'percentage', percentage: 100 }), descriptor(2, 3));
});

test('the size planner preserves declared depth and color and applies byte limits to both sides', () => {
	const input = { ...descriptor(2, 2), sampleFormat: 'float32', primaries: 'display-p3', transfer: 'linear' };
	const plan = planImageExportSizeV1(input, { kind: 'percentage', percentage: 200 });
	assert.deepEqual(plan.target, { ...input, width: 4, height: 4 });
	assert.equal(plan.byteLength, 256);
	assert.throws(() => planImageExportSizeV1(input, { kind: 'percentage', percentage: 200 }, { maximumBytes: 255 }), /byte length/u);
	assert.throws(() => planImageExportSizeV1(input, { kind: 'percentage', percentage: 50 }, { maximumBytes: 63 }), /byte length/u);
});

test('a reflected sizing record cannot widen the captured target capacity', () => {
	const limits = { maximumPixels: 16 };
	const sizing = new Proxy({ kind: 'percentage', percentage: 300 }, {
		getOwnPropertyDescriptor(target, key) {
			limits.maximumPixels = 64;
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	assert.throws(() => planImageExportSizeV1(descriptor(2, 2), sizing, limits), /pixel count/u);
	assert.equal(limits.maximumPixels, 64);
});

test('generated fit, long-edge and megapixel plans stay within their requested bounds', () => {
	for (const [width, height] of [[1, 65_536], [65_536, 1], [137, 911], [911, 137], [3, 2], [2, 3], [1, 1]]) {
		for (const ceiling of [1, 2, 7, 101, 1_000]) {
			const fit = size(width!, height!, { kind: 'fit', width: ceiling, height: ceiling, allowUpscale: false });
			assert.ok(fit.width <= ceiling && fit.height <= ceiling);
			assert.ok(fit.width <= width! && fit.height <= height!);
			const edge = size(width!, height!, { kind: 'long-edge', pixels: ceiling, allowUpscale: false });
			assert.ok(Math.max(edge.width, edge.height) <= ceiling);
			const mp = size(width!, height!, { kind: 'megapixels', megapixels: ceiling / 1_000_000, allowUpscale: true });
			assert.ok(mp.width >= 1 && mp.height >= 1 && mp.width * mp.height <= ceiling);
		}
	}
});

test('closed sizing refuses future modes, missing fields and accessors without evaluating them', () => {
	let reads = 0;
	const accessor = Object.defineProperty({}, 'kind', { enumerable: true, get() { reads++; return 'original'; } });
	for (const sizing of [null, [], 'original', { kind: 'future' }, {}, { kind: 'original', extra: 1 },
		{ kind: 'fit', width: 10, height: 10 }, { kind: 'long-edge', pixels: 10, allowUpscale: 'yes' },
		{ kind: 'percentage', percentage: 100, allowUpscale: true }, accessor,
		Object.create({ kind: 'original' }) as unknown, { kind: 'original', [Symbol('future')]: true }]) {
		assert.throws(() => size(2, 2, sizing));
	}
	assert.equal(reads, 0);
});

test('numeric domains and existing frame ceilings are checked before any output allocation', () => {
	for (const value of [0, -1, 0.5, 65_537, NaN, Infinity, '10']) {
		assert.throws(() => size(2, 2, { kind: 'fit', width: value, height: 10, allowUpscale: true }));
		assert.throws(() => size(2, 2, { kind: 'long-edge', pixels: value, allowUpscale: true }));
	}
	for (const value of [0, -1, 0.000_000_9, 68, NaN, Infinity, '1']) {
		assert.throws(() => size(2, 2, { kind: 'megapixels', megapixels: value, allowUpscale: false }));
	}
	for (const value of [0, -1, 10_001, NaN, Infinity, '100']) {
		assert.throws(() => size(2, 2, { kind: 'percentage', percentage: value }));
	}
	assert.throws(() => size(65_536, 1, { kind: 'percentage', percentage: 200 }), /dimension/u);
	assert.throws(() => size(8_192, 8_192, { kind: 'percentage', percentage: 101 }), /pixel count/u);
	assert.throws(() => planImageExportSizeV1(descriptor(2, 2), { kind: 'original' }, { maximumPixels: 3 }), /pixel count/u);
});
