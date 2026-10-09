/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withNoiseReductionPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-noise-reduction-v1.ts';
import { noiseReductionReferenceV1, type NoiseReductionReferenceControlsV1 } from './helpers/video-noise-reduction-reference.ts';

const DEFAULTS: NoiseReductionReferenceControlsV1 = Object.freeze({ luminance: 0, luminanceDetail: 50, luminanceContrast: 0,
	color: 0, colorDetail: 50, colorSmoothness: 50 });
const controls = (changes: Partial<NoiseReductionReferenceControlsV1>): NoiseReductionReferenceControlsV1 => ({ ...DEFAULTS, ...changes });
const GRAY = [40,40,40,255,100,100,100,255,160,160,160,255];
const CHROMA = [110,110,150,255,130,130,90,255,110,110,150,255];
const limits = { maximumSidePixels: 32, maximumPixels: 1024, maximumBytes: 4096 };

async function actual(source: readonly number[], width: number, params: NoiseReductionReferenceControlsV1, enabled = true): Promise<number[]> {
	const pixels = new Uint8Array(source); let borrowed: Uint8Array | undefined, deliveries = 0;
	const result = await withNoiseReductionPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width, height: source.length / (4 * width),
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels }, effect: { id: 'reference', type: 'noise-reduction-v1', enabled, params } },
		frame => { deliveries++; borrowed = frame.pixels; return [...frame.pixels]; }, { limits });
	assert.equal(deliveries, 1); assert.deepEqual([...pixels], source); assert.ok(borrowed?.every(byte => byte === 0)); return result;
}

test('independent literal luma goldens bind replicated edges, alpha175 weighting and inverse gamut clamping', async () => {
	const params = controls({ luminance: 100, luminanceDetail: 0 });
	const cases = [
		{ source: GRAY, expected: [55,55,55,255,100,100,100,255,145,145,145,255] },
		{ source: [40,40,40,175,100,100,100,255,160,160,160,175], expected: [60,60,60,175,100,100,100,255,140,140,140,175] },
		{ source: [255,0,0,255,255,255,255,255,255,0,0,255], expected: [255,48,48,255,159,159,159,255,255,48,48,255] },
	];
	for (const { source, expected } of cases) {
		assert.deepEqual(noiseReductionReferenceV1(source, 3, params), expected);
		assert.deepEqual(await actual(source, 3, params), expected);
		assert.deepEqual(await actual(source, 1, params), expected, 'vertical and horizontal replicated one-dimensional edges agree');
	}
});

test('independent chroma literals retain signed half-up means and distinct three/five-tap extents', async () => {
	const half = controls({ color: 50, colorDetail: 0, colorSmoothness: 0 });
	const source = [0,0,1,255,1,0,0,255,0,0,1,255], expected = [0,0,0,255,1,0,0,255,0,0,0,255];
	assert.deepEqual(noiseReductionReferenceV1(source, 3, half), expected); assert.deepEqual(await actual(source, 3, half), expected);
	for (const [smoothness, pixels] of [[0, [115,115,135,255,120,120,120,255,115,115,135,255]],
		[100, [115,115,135,255,118,118,128,255,115,115,135,255]]] as const) {
		const params = controls({ color: 100, colorDetail: 0, colorSmoothness: smoothness });
		assert.deepEqual(noiseReductionReferenceV1(CHROMA, 3, params), pixels); assert.deepEqual(await actual(CHROMA, 3, params), pixels);
	}
});

const roles: readonly Readonly<{ key: keyof NoiseReductionReferenceControlsV1; source: readonly number[];
	base: Partial<NoiseReductionReferenceControlsV1> }>[] = [
	{ key: 'luminance', source: GRAY, base: { luminanceDetail: 0 } },
	{ key: 'luminanceDetail', source: GRAY, base: { luminance: 100 } },
	{ key: 'luminanceContrast', source: GRAY, base: { luminance: 100, luminanceDetail: 0 } },
	{ key: 'color', source: CHROMA, base: { colorDetail: 0, colorSmoothness: 0 } },
	{ key: 'colorDetail', source: CHROMA, base: { color: 100, colorSmoothness: 0 } },
	{ key: 'colorSmoothness', source: CHROMA, base: { color: 100, colorDetail: 0 } },
];
for (const { key, source, base } of roles) test(`independent oracle exercises the ${key} control role`, async () => {
	const before = controls({ ...base, [key]: 0 }), after = controls({ ...base, [key]: 100 });
	const first = noiseReductionReferenceV1(source, 3, before), second = noiseReductionReferenceV1(source, 3, after);
	assert.notDeepEqual(first, second, `${key} must affect this independent fixture`);
	assert.deepEqual(await actual(source, 3, before), first); assert.deepEqual(await actual(source, 3, after), second);
});

test('exact fractional Q8 amount rounding distinguishes below, at and above a half-code boundary', async () => {
	const source = [0,0,0,1,255,255,255,255];
	for (const [amount, expected] of [[0.1943359375, source], [0.1953125, [1,1,1,1,255,255,255,255]],
		[0.1962890625, [1,1,1,1,255,255,255,255]]] as const) {
		const params = controls({ luminance: amount, luminanceDetail: 0 });
		assert.deepEqual(noiseReductionReferenceV1(source, 2, params), expected); assert.deepEqual(await actual(source, 2, params), expected);
	}
});

test('adjacent binary64 values at every Q8 half-step preserve the declared IEEE multiply/divide rounding', async () => {
	const source = [0,0,0,1,255,255,255,255], view = new DataView(new ArrayBuffer(8));
	for (let code = 0; code < 256; code++) {
		const midpoint = (code + 0.5) * 100 / 256; view.setFloat64(0, midpoint); const bits = view.getBigUint64(0);
		for (const offset of [-1n, 0n, 1n]) {
			view.setBigUint64(0, bits + offset); const amount = view.getFloat64(0), params = controls({ luminance: amount, luminanceDetail: 0 });
			assert.deepEqual(await actual(source, 2, params), noiseReductionReferenceV1(source, 2, params), `Q8 ${code}+0.5, ULP ${offset}, value ${amount}`);
		}
	}
});

test('bounded generated two-dimensional fixtures compare every control, fractional Q8 and replicated corner neighborhoods', async () => {
	const profiles = [controls({}), controls({ luminance: 100, luminanceDetail: 0, color: 100, colorDetail: 0, colorSmoothness: 0 }),
		controls({ luminance: 100, luminanceDetail: 100, luminanceContrast: 100, color: 100, colorDetail: 100, colorSmoothness: 100 }),
		controls({ luminance: 37.125, luminanceDetail: 6.25, luminanceContrast: 81.25, color: 62.890625, colorDetail: 3.125, colorSmoothness: 37.5 }),
		controls({ luminance: 50.1953125, luminanceDetail: 0.1953125, luminanceContrast: 25.5859375, color: 75.1953125, colorDetail: 0.390625, colorSmoothness: 41.40625 }),
		controls({ luminance: 0.01, color: 0.01 }), controls({ luminance: 99.609375, color: 99.609375, luminanceDetail: 0, colorDetail: 0, colorSmoothness: 99.609375 })];
	for (const [width, height] of [[1,1], [1,7], [7,1], [2,3], [3,2], [5,5], [7,6]] as const) {
		const source = fixture(width, height);
		for (const params of profiles) assert.deepEqual(await actual(source, width, params), noiseReductionReferenceV1(source, width, params),
			`${width}x${height}: ${JSON.stringify(params)}`);
		assert.deepEqual(await actual(source, width, profiles[1]!, false), source);
	}
});

test('all256 alpha values including zero and175 retain original alpha and transparent hidden gamut bytes', async () => {
	const source = Array.from({ length: 256 }, (_, alpha) => [alpha % 2 ? 255 : 0, (alpha * 17) % 256, 255 - alpha, alpha]).flat();
	const params = controls({ luminance: 81.25, luminanceDetail: 0, luminanceContrast: 37.125, color: 63.28125, colorDetail: 0, colorSmoothness: 50.1953125 });
	const expected = noiseReductionReferenceV1(source, 16, params), result = await actual(source, 16, params);
	assert.deepEqual(result, expected); assert.deepEqual(result.slice(0, 4), source.slice(0, 4));
	for (let alpha = 0; alpha < 256; alpha++) assert.equal(result[alpha * 4 + 3], alpha);
});

test('ordered repeated stages compare fresh original neighborhoods and release every scoped CPU output', async () => {
	const source = fixture(5, 5), first = controls({ luminance: 100, luminanceDetail: 0 }),
		second = controls({ color: 100, colorDetail: 0, colorSmoothness: 37.125 });
	let expected = source, rendered = source;
	for (const params of [first, second, first]) {
		expected = noiseReductionReferenceV1(expected, 5, params); rendered = await actual(rendered, 5, params); assert.deepEqual(rendered, expected);
	}
	const reverse = noiseReductionReferenceV1(noiseReductionReferenceV1(noiseReductionReferenceV1(source, 5, second), 5, first), 5, second);
	assert.notDeepEqual(expected, reverse, 'the bounded fixture distinguishes authored operation order');
});

function fixture(width: number, height: number): number[] {
	const palette = [[0,0,0], [255,255,255], [255,0,0], [0,255,0], [0,0,255], [73,128,219], [99,100,101], [130,110,90]];
	const alpha = [0,1,127,175,254,255]; let seed = width * 8191 + height;
	return Array.from({ length: width * height }, (_, index) => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const rgb = palette[(seed >>> 16) % palette.length]!;
		return [...rgb, alpha[index % alpha.length]!];
	}).flat();
}
