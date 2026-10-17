/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2SpatialCurrentV1 as spatial } from '../src/common/editor/imaging/pixel-frame-webgl2-spatial-current-v1.ts';
import { preparePixelFrameWebGl2GeometryCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-geometry-current-v1.ts';
import { planPixelFrameWebGl2CurrentV1, withPixelFrameWebGl2CurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-current-v1.ts';

const descriptor = (width: number, height: number) => ({ schemaVersion: 1 as const, width, height,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
const effect = (id = 'detail') => ({ id, type: 'detail-sharpen-v1', enabled: true, params: { amount: 50, threshold: 0 } });

test('spatial admission reserves exactly two normative planes and two textures without reading pixels', () => {
	const input = descriptor(4, 2); let reads = 0;
	const plan = planPixelFrameWebGl2CurrentV1({ frame: { descriptor: input, get pixels() { reads++; throw new Error('pixels'); } }, passes: [spatial(effect(), input)] });
	assert.equal(reads, 0); assert.equal(plan.pipeline.hasSpatial, true); assert.equal(plan.pipeline.hasGeometry, false); assert.equal(plan.pipeline.hasOptics, false);
	assert.equal(plan.pipeline.hasPlaneReference, true); assert.equal(plan.pipeline.referenceBytes, 256);
	assert.equal(plan.pipeline.textureBytes, 256); assert.equal(plan.pipeline.readbackBytes, 128);
	assert.equal(plan.gpuWorkingBytes, 128 + 128 + 256 + 128 + 256 + 4096); assert.equal(plan.eligible, true);
});

test('wrong incoming spatial aperture and cloned private plans refuse before source reflection', () => {
	const input = descriptor(4, 2), geometry = preparePixelFrameWebGl2GeometryCurrentV1({ schemaVersion: 1,
		crop: { x: 0, y: 0, width: .5, height: .5 }, rotationDegrees: 0, flipHorizontal: false, flipVertical: false, perspective: null }, input);
	const pass = spatial(effect(), input); let reads = 0;
	const frame = { descriptor: input, get pixels() { reads++; throw new Error('pixels'); } };
	assert.throws(() => planPixelFrameWebGl2CurrentV1({ frame, passes: [geometry, pass] }), /binding|descriptor|chain/u);
	assert.throws(() => planPixelFrameWebGl2CurrentV1({ frame, passes: [{ ...pass }] }), /prepared|owning|identity/u); assert.equal(reads, 0);
});

test('257 spatial passes retain the same two-plane maximum and bounded chain admission', () => {
	const input = descriptor(1, 1), passes = Array.from({ length: 257 }, (_, index) => spatial(effect(`spatial-${index}`), input));
	const plan = planPixelFrameWebGl2CurrentV1({ frame: { descriptor: input }, passes });
	assert.equal(plan.passes.length, 257); assert.equal(plan.pipeline.referenceBytes, 32); assert.equal(plan.pipeline.textureBytes, 32);
	assert.throws(() => planPixelFrameWebGl2CurrentV1({ frame: { descriptor: input }, passes: [...passes, passes[0]] }), /257|length|count|maximum/u);
});

test('padded Original plus spatial reference planes selects captured CPU before GL and wipes its capture', async () => {
	const input = descriptor(1024, 1024), backing = new ArrayBuffer(700 * 1024 * 1024), pixels = new Float32Array(backing, 0, 1024 * 1024 * 4);
	pixels[0] = -.125; pixels[3] = .5; let calls = 0, captured: ArrayBuffer | undefined;
	const actual = await withPixelFrameWebGl2CurrentV1({ frame: { descriptor: input, pixels }, passes: [spatial(effect(), input)] }, view => {
		calls++; assert.equal(view.backend, 'cpu'); if (view.backend !== 'cpu') throw new Error('CPU required.');
		assert.equal(view.reason, 'working-set'); captured = view.source.pixels.buffer; return [view.source.pixels[0], view.source.pixels[3]];
	});
	assert.deepEqual(actual, [-.125, .5]); assert.equal(calls, 1); assert.ok(captured);
	assert.equal(new Uint8Array(captured).every(value => value === 0), true); assert.equal(pixels[0], -.125); assert.equal(pixels[3], .5);
});
