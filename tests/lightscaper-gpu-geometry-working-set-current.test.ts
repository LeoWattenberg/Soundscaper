/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2GeometryCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-geometry-current-v1.ts';
import { planPixelFrameWebGl2CurrentV1, withPixelFrameWebGl2CurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-current-v1.ts';
import { preparePixelFrameWebGl2ColorsCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-color-current-v1.ts';

const geometry = (rotationDegrees = 0) => ({ schemaVersion: 1, crop: null, rotationDegrees,
	flipHorizontal: false, flipVertical: false, perspective: null });
const descriptor = (width: number, height: number) => ({ schemaVersion: 1 as const, width, height,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });

test('geometry admits every natural stage extent and two normative planes before reading native samples', () => {
	const input = descriptor(4, 2), pass = preparePixelFrameWebGl2GeometryCurrentV1(geometry(45), input);
	let reads = 0;
	const plan = planPixelFrameWebGl2CurrentV1({ frame: { descriptor: input, get pixels() { reads++; throw new Error('pixels'); } }, passes: [pass] });
	assert.equal(reads, 0); assert.deepEqual([plan.pipeline.finalDescriptor.width, plan.pipeline.finalDescriptor.height], [5, 5]);
	assert.equal(plan.floatBytes, 128); assert.equal(plan.pipeline.maximumFrameBytes, 400);
	assert.equal(plan.pipeline.referenceBytes, 800); assert.equal(plan.pipeline.readbackBytes, 400);
	assert.equal(plan.gpuWorkingBytes, 128 + 128 + 800 + 400 + 800 + 4096);
	assert.equal(plan.eligible, true);
});

test('geometry descriptor transitions reject an out-of-order prepared pass before pixel reflection', () => {
	const input = descriptor(3, 2), turn = preparePixelFrameWebGl2GeometryCurrentV1(geometry(90), input);
	let reads = 0;
	assert.throws(() => planPixelFrameWebGl2CurrentV1({ frame: { descriptor: input, get pixels() { reads++; throw new Error('pixels'); } },
		passes: [turn, turn] }), /descriptor|binding|chain/u);
	assert.equal(reads, 0);
});

test('one legacy geometry and all256 authored effects retain the complete257-pass chain', () => {
	const input = descriptor(1, 1), first = preparePixelFrameWebGl2GeometryCurrentV1(geometry(), input);
	const colors = preparePixelFrameWebGl2ColorsCurrentV1(Array.from({ length: 256 }, (_, index) => ({
		id: `exposure-${index}`, type: 'tone-ladder-v1', enabled: true, params: { exposure: index % 2 ? -1 : 1 },
	})));
	const plan = planPixelFrameWebGl2CurrentV1({ frame: { descriptor: input }, passes: [first, ...colors] });
	assert.equal(plan.passes.length, 257); assert.equal(plan.pipeline.referenceBytes, 32);
	assert.throws(() => planPixelFrameWebGl2CurrentV1({ frame: { descriptor: input }, passes: [first, first, ...colors] }), /257|length|count|maximum/u);
});

test('physical Original padding overlaps both normative planes and selects CPU before GL', async () => {
	const input = descriptor(1024, 1024), backing = new ArrayBuffer(700 * 1024 * 1024);
	const pixels = new Float32Array(backing, 0, 1024 * 1024 * 4); pixels[0] = -.125; pixels[3] = .5;
	const pass = preparePixelFrameWebGl2GeometryCurrentV1(geometry(90), input);
	let calls = 0; let captured: ArrayBuffer | undefined;
	const result = await withPixelFrameWebGl2CurrentV1({ frame: { descriptor: input, pixels }, passes: [pass] }, view => {
		calls++; assert.equal(view.backend, 'cpu'); if (view.backend !== 'cpu') throw new Error('CPU required.');
		assert.equal(view.reason, 'working-set'); captured = view.source.pixels.buffer;
		return [view.source.pixels[0], view.source.pixels[3]];
	});
	assert.deepEqual(result, [-.125, .5]); assert.equal(calls, 1); assert.ok(captured);
	assert.equal(new Uint8Array(captured).every(value => value === 0), true);
	assert.equal(pixels[0], -.125); assert.equal(pixels[3], .5);
});
