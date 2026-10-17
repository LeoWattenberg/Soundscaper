/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { NOISE_REDUCTION_PROCESS_V1, normalizeNoiseReductionParamsV1, prepareNoiseReductionEffectV1,
	noiseReductionLumaV1, noiseReductionChromaV1, noiseReductionPreviewPassV1 } from '../src/common/editor/video-noise-reduction-v1.ts';
import { withNoiseReductionPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-noise-reduction-v1.ts';

const effect = (params: unknown = {}, enabled = true) => ({ id: 'noise', type: 'noise-reduction-v1', enabled, params });
const limits = { maximumSidePixels: 1024, maximumPixels: 262144, maximumBytes: 1048576 };
async function render(source: readonly number[], width: number, params: unknown, enabled = true) {
	const pixels = new Uint8Array(source);
	const descriptor = { schemaVersion: 1, width, height: source.length / 4 / width, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' };
	const output = await withNoiseReductionPixelFrameV1({ frame: { descriptor, pixels }, effect: effect(params, enabled) }, view => [...view.pixels], { limits });
	assert.deepEqual([...pixels], source); return output;
}

test('noise reduction has six closed detached controls and an explicit reversible-luma Q8 process', () => {
	assert.equal(NOISE_REDUCTION_PROCESS_V1, 'srgb-alpha-bilateral-ycocg-noise-q8-v1');
	assert.deepEqual(normalizeNoiseReductionParamsV1(undefined), { luminance: 0, luminanceDetail: 50, luminanceContrast: 0, color: 0, colorDetail: 50, colorSmoothness: 50 });
	const raw = { luminance: 37.125, color: 50 }, normalized = normalizeNoiseReductionParamsV1(raw);
	raw.luminance = 0; assert.equal(normalized.luminance, 37.125); assert.ok(Object.isFrozen(normalized));
	const prepared = prepareNoiseReductionEffectV1(effect(normalized)); assert.equal(prepared.luminanceQ8, 95); assert.equal(prepared.colorQ8, 128);
	for (const key of ['luminance', 'luminanceDetail', 'luminanceContrast', 'color', 'colorDetail', 'colorSmoothness']) {
		for (const value of [-0.1, 100.01, NaN, Infinity, null, '50']) assert.throws(() => normalizeNoiseReductionParamsV1({ [key]: value }));
	}
	for (const value of [null, { future: 1 }, { color: undefined }]) assert.throws(() => normalizeNoiseReductionParamsV1(value));
	let reads = 0; const getter = Object.defineProperty({}, 'luminance', { enumerable: true, get() { reads++; return 50; } });
	assert.throws(() => normalizeNoiseReductionParamsV1(getter)); assert.equal(reads, 0);
	assert.equal(Object.is(normalizeNoiseReductionParamsV1({ color: -0 }).color, -0), false);
});

test('signed noise blends round half toward positive infinity and round the weighted mean first', () => {
	const half = prepareNoiseReductionEffectV1(effect({ luminance: 50, color: 50 }));
	assert.equal(noiseReductionLumaV1(half, 100, 99, 1, 99, 100), 100);
	assert.equal(noiseReductionLumaV1(half, 100, 101, 1, 100, 101), 101);
	assert.equal(noiseReductionChromaV1(half, 0, -1, 1), 0);
	assert.equal(noiseReductionChromaV1(half, 0, 1, 1), 1);
	assert.equal(noiseReductionChromaV1(half, -10, -21, 2), -10, 'mean -10.5 rounds -10 before blending');
	const full = prepareNoiseReductionEffectV1(effect({ luminance: 100, color: 100 }));
	assert.equal(noiseReductionLumaV1(full, 10, 31, 3, 10, 11), 10);
	assert.equal(noiseReductionLumaV1(full, 10, 32, 3, 10, 11), 11);
	assert.throws(() => noiseReductionLumaV1({ ...full }, 10, 32, 3, 10, 11));
	assert.throws(() => noiseReductionChromaV1({ ...full }, 0, -1, 1));
});

test('luma impulse, replicated edges, detail threshold and contrast protection have literal goldens', async () => {
	const impulse = [100,100,100,255,200,200,200,255,100,100,100,255];
	assert.deepEqual(await render(impulse, 3, { luminance: 100, luminanceDetail: 0 }), [125,125,125,255,150,150,150,255,125,125,125,255]);
	assert.deepEqual(await render(impulse, 3, { luminance: 50, luminanceDetail: 0 }), [113,113,113,255,175,175,175,255,113,113,113,255]);
	assert.deepEqual(await render(impulse, 3, { luminance: 100, luminanceDetail: 100 }), impulse);
	assert.deepEqual(await render(impulse, 3, { luminance: 100, luminanceDetail: 0, luminanceContrast: 100 }), [115,115,115,255,170,170,170,255,115,115,115,255]);
	assert.deepEqual(await render([40,40,40,255,100,100,100,255,160,160,160,255], 3, { luminance: 100, luminanceDetail: 0 }),
		[55,55,55,255,100,100,100,255,145,145,145,255]);
});

test('chroma-only reduction preserves reversible luma with literal 3x3 and 5x5 speckle goldens', async () => {
	const speckle = [110,110,150,255,130,130,90,255,110,110,150,255];
	assert.deepEqual(await render(speckle, 3, { color: 100, colorDetail: 0, colorSmoothness: 0 }), [115,115,135,255,120,120,120,255,115,115,135,255]);
	assert.deepEqual(await render(speckle, 3, { color: 100, colorDetail: 0, colorSmoothness: 100 }), [115,115,135,255,118,118,128,255,115,115,135,255]);
	assert.deepEqual(await render(speckle, 3, { color: 100, colorDetail: 100 }), speckle);
	assert.deepEqual(await render(speckle, 3, { luminance: 100, luminanceDetail: 0 }), speckle, 'equal Y isolates chroma noise');
});

test('neutral, disabled, hidden RGB and original alpha are exact for all 256 alpha bytes', async () => {
	const source = Array.from({ length: 256 }, (_, alpha) => [73,128,219,alpha]).flat();
	for (const [params, enabled] of [[{}, true], [{ luminance: 0.01, color: 0.01 }, true], [{ luminance: 100, color: 100 }, false]] as const) {
		assert.deepEqual(await render(source, 256, params, enabled), source);
	}
	assert.deepEqual(await render(source, 256, { luminance: 100, color: 100, luminanceDetail: 0, colorDetail: 0 }), source);
	const transparent = [255,0,255,0,100,100,100,173,0,255,0,0];
	assert.deepEqual(await render(transparent, 3, { luminance: 100, color: 100, luminanceDetail: 0, colorDetail: 0 }), transparent);
	const single = [254,1,253,175]; assert.deepEqual(await render(single, 1, { luminance: 100, color: 100 }), single);
});

test('preview admission remains disabled or neutral only after validating every control', () => {
	assert.equal(noiseReductionPreviewPassV1(effect()), null);
	assert.equal(noiseReductionPreviewPassV1(effect({ luminance: 100 }, false)), null);
	assert.throws(() => noiseReductionPreviewPassV1(effect({ color: -1 }, false)));
	assert.deepEqual(noiseReductionPreviewPassV1(effect({ luminance: 37.125, color: 50 })), { code: 30,
		params0: [95,128,0,128], params1: [128,128,0,0], direction: [0,0] });
});
