/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DETAIL_SHARPEN_PROCESS_V1, normalizeDetailSharpenParamsV1, prepareDetailSharpenEffectV1,
	detailSharpenByteV1, detailSharpenPreviewPassV1, serializeDetailSharpenEffectToFfmpegV1 } from '../src/common/editor/video-sharpen-v1.ts';
import { withDetailSharpenPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-sharpen-v1.ts';

const effect = (params: unknown = {}, enabled = true) => ({ id: 'detail', type: 'detail-sharpen-v1', enabled, params });
const limits = Object.freeze({ maximumSidePixels: 1024, maximumPixels: 262144, maximumBytes: 1048576 });
const descriptor = (width: number, height: number) => ({ schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
async function render(source: readonly number[], width: number, height: number, params: unknown = {}, enabled = true) {
	const pixels = new Uint8Array(source);
	const output = await withDetailSharpenPixelFrameV1({ frame: { descriptor: descriptor(width, height), pixels }, effect: effect(params, enabled) },
		view => [...view.pixels], { limits });
	assert.deepEqual([...pixels], source); return output;
}

test('new detail sharpening has an explicit Q8 process, closed detached parameters and native integer gain', () => {
	assert.equal(DETAIL_SHARPEN_PROCESS_V1, 'srgb-alpha-binomial-detail-q8-v1');
	const raw = { amount: 37.125, threshold: 3 }, normalized = normalizeDetailSharpenParamsV1(raw);
	raw.amount = 0; assert.deepEqual(normalized, { amount: 37.125, threshold: 3 }); assert.ok(Object.isFrozen(normalized));
	assert.equal(prepareDetailSharpenEffectV1(effect(normalized)).gainQ8, 95);
	for (const value of [{ amount: -1 }, { amount: 200.01 }, { amount: NaN }, { threshold: 1.1 }, { threshold: 256 }, { future: 1 }]) {
		assert.throws(() => normalizeDetailSharpenParamsV1(value));
	}
	let reads = 0; const getter = Object.defineProperty({}, 'amount', { enumerable: true, get() { reads++; return 100; } });
	assert.throws(() => normalizeDetailSharpenParamsV1(getter)); assert.equal(reads, 0);
});

test('signed gain ties round toward positive infinity and odd alpha-weight sums round the blur first', () => {
	const half = prepareDetailSharpenEffectV1(effect({ amount: 50 }));
	assert.equal(detailSharpenByteV1(half, 100, 101, 1), 100, 'negative half tie stays100');
	assert.equal(detailSharpenByteV1(half, 100, 99, 1), 101, 'positive half tie becomes101');
	const full = prepareDetailSharpenEffectV1(effect());
	assert.equal(detailSharpenByteV1(full, 10, 31, 3), 10, '10.333 blur rounds10');
	assert.equal(detailSharpenByteV1(full, 10, 32, 3), 9, '10.667 blur rounds11');
	assert.equal(detailSharpenByteV1(full, 10, 21, 2), 9, '10.5 blur rounds11');
	assert.equal(detailSharpenByteV1(full, 1, 100, 1), 0); assert.equal(detailSharpenByteV1(full, 254, 1, 1), 255);
	assert.equal(detailSharpenByteV1(prepareDetailSharpenEffectV1(effect({ threshold: 1 })), 10, 32, 3), 10);
});

test('replicated-edge three-pixel gradient and opaque impulse have literal neighborhood goldens', async () => {
	const gradient = [40,40,40,255,100,100,100,255,160,160,160,255];
	assert.deepEqual(await render(gradient, 3, 1), [25,25,25,255,100,100,100,255,175,175,175,255]);
	assert.deepEqual(await render(gradient, 3, 1, { amount: 50 }), [33,33,33,255,100,100,100,255,168,168,168,255]);
	assert.deepEqual(await render([100,100,100,255,200,200,200,255,100,100,100,255], 3, 1),
		[75,75,75,255,250,250,250,255,75,75,75,255]);
});

test('transparent neighbors cannot bleed hidden RGB; alpha-zero centers and every alpha byte stay exact', async () => {
	const source = [255,0,255,0,100,40,10,127,0,255,0,0];
	assert.deepEqual(await render(source, 3, 1), source);
	const every = Array.from({ length: 256 }, (_, n) => [80,120,160,n]).flat();
	assert.deepEqual(await render(every, 256, 1), every);
	const variable = Array.from({ length: 256 }, (_, n) => [n,255-n,(n*17)%256,n]).flat();
	const output = await render(variable, 256, 1, { amount: 200, threshold: 2 });
	assert.deepEqual(output.filter((_, n) => n % 4 === 3), Array.from({ length: 256 }, (_, n) => n));
	assert.deepEqual(output.slice(0, 4), variable.slice(0, 4));
	assert.deepEqual(await render(variable, 256, 1, { amount: 0 }), variable);
	assert.deepEqual(await render(variable, 256, 1, {}, false), variable);
});

test('preview and generated export use prepared gain, alpha-aware neighborhood and the owning code27', () => {
	const pass = detailSharpenPreviewPassV1(effect({ amount: 37.125, threshold: 3 }));
	assert.equal(pass?.code, 27); assert.deepEqual(pass?.params0, [95,3,0,0]);
	assert.equal(detailSharpenPreviewPassV1(effect({ amount: 0 })), null);
	assert.equal(detailSharpenPreviewPassV1(effect({}, false)), null);
	const operation = serializeDetailSharpenEffectToFfmpegV1(effect({ amount: 37.125, threshold: 3 }));
	assert.equal(operation?.preserveAlpha, true); assert.match(operation!.expression, /alpha\(clip\(X-1,0,W-1\),clip\(Y-1,0,H-1\)\)/u);
	assert.match(operation!.expression, /95/u); assert.match(operation!.expression, /interpolation=nearest/u);
});
