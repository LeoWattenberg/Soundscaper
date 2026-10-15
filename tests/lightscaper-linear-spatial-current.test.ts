/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearSpatialEffectV1, writeLinearSpatialEffectV1 } from '../src/common/editor/imaging/pixel-frame-linear-spatial-v1.ts';
import { withDetailSharpenPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-sharpen-v1.ts';
import { withClarityPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-clarity-v1.ts';
import { withNoiseReductionPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-noise-reduction-v1.ts';
import { withGrainPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-grain-v1.ts';
import { withTexturePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-texture-v1.ts';
import { withDehazePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-dehaze-v1.ts';
import { withPostCropVignettePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-post-crop-vignette-v1.ts';

const LIMITS = { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 };
const effect = (type: string, params: Record<string, unknown> = {}, enabled = true) => ({ id: type, type, enabled, params });
function descriptor(width: number, height = 1) { return { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }; }
function decode(value: number): number { const n = Math.abs(value); return Math.sign(value) * (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4); }
function encode(value: number): number { const n = Math.abs(value); return Math.sign(value) * (n <= 0.0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - 0.055); }
function close(actual: number, expected: number): void { assert.ok(Math.abs(actual - expected) <= 2e-6 * Math.max(1, Math.abs(expected)), `${String(actual)} != ${String(expected)}`); }
function gray(values: readonly number[]): Float32Array<ArrayBuffer> { return new Float32Array(values.flatMap(value => [decode(value), decode(value), decode(value), 1])); }
async function run(type: string, params: Record<string, unknown>, source: Float32Array<ArrayBuffer>, width = source.length / 4, height = 1) {
	const plan = prepareLinearSpatialEffectV1(effect(type, params), descriptor(width, height));
	const target = new Float32Array(source.length), before = source.slice();
	await writeLinearSpatialEffectV1(plan, source, target, new Uint8Array(plan.scratchBytes));
	assert.deepEqual(source, before); return target;
}

test('native detail sharpening reads an immutable alpha-weighted binomial neighborhood and keeps signed overshoot', async () => {
	const output = await run('detail-sharpen-v1', { amount: 100 }, gray([0.25, 0.5, 0.75]));
	for (const [index, value] of [0.1875, 0.5, 0.8125].entries()) close(output[index * 4]!, decode(value));
	const overshoot = await run('detail-sharpen-v1', { amount: 200 }, gray([0, 1, 0]));
	close(overshoot[4]!, decode(2)); assert.ok(overshoot[4]! > 1); assert.ok(overshoot[0]! < 0);
	const threshold = await run('detail-sharpen-v1', { amount: 200, threshold: 255 }, gray([0.25, 0.5, 0.75]));
	assert.deepEqual(threshold, gray([0.25, 0.5, 0.75]));
	const alphaWeighted = await run('detail-sharpen-v1', { amount: 200 }, new Float32Array([100, -1, 0, 0, 0, 0, 1, 1]));
	assert.deepEqual(alphaWeighted, new Float32Array([100, -1, 0, 0, 0, 0, 1, 1]));
});

test('clarity and texture use their distinct complete seven and three/five-tap neighborhoods', async () => {
	const seven = Array<number>(49).fill(0.25); seven[24] = 0.5;
	const clarity = await run('clarity-v1', { amount: 100 }, gray(seven), 7, 7);
	// Center binomial weight400 of4096; the bounded midpoint gate is one.
	close(clarity[24 * 4]!, decode(0.7255859375));
	const five = Array<number>(25).fill(0.25); five[12] = 0.5;
	const texture = await run('texture-v1', { amount: 100 }, gray(five), 5, 5);
	// Fine=.3125, coarse=.28515625. Preserve the authored coarse-edge gate /256.
	const gate = 1 - 4 * 255 * (0.5 - 0.28515625) / 256;
	close(texture[12 * 4]!, decode(0.5 + 0.02734375 * gate));
	assert.notEqual(texture[12 * 4], clarity[24 * 4]);
});

test('noise reduction implements bilateral luma and separately controlled blended chroma neighborhoods', async () => {
	const luma = await run('noise-reduction-v1', { luminance: 100, luminanceDetail: 0 }, gray([0.25, 0.5, 0.75]));
	close(luma[0]!, decode(0.3125)); close(luma[4]!, decode(0.5)); close(luma[8]!, decode(0.6875));
	const color = new Float32Array([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1]);
	const output = await run('noise-reduction-v1', { color: 100, colorDetail: 0, colorSmoothness: 0 }, color);
	// Original green Y=.5; the3x3 chroma mean is Co0/Cg.25.
	close(output[4]!, decode(0.375)); close(output[5]!, decode(0.625)); close(output[6]!, decode(0.375));
	const protectedOutput = await run('noise-reduction-v1', { luminance: 100, luminanceDetail: 100, luminanceContrast: 100 }, gray([0, 1, 0]));
	assert.equal(protectedOutput[4], 1);
});

test('dehaze retains the native dark-channel/transmission formula and signed fog blend without gamut clipping', async () => {
	const clear = await run('dehaze-v1', { amount: 100 }, gray([0.5]));
	// Transmission=1-.5*243/256=269/512, output=1-.5/transmission.
	close(clear[0]!, decode(13 / 269));
	const fog = await run('dehaze-v1', { amount: -100 }, new Float32Array([decode(-2), decode(2), decode(0.5), 0.375]));
	close(fog[0]!, decode(-0.5)); close(fog[1]!, decode(1.5)); close(fog[2]!, decode(0.75)); assert.equal(fog[3], 0.375);
});

test('vignette is tied to current natural pixel centers and keeps highlight protection and true floating RGB', async () => {
	const source = gray([0.25, 0.75]);
	const light = await run('post-crop-vignette-v1', { amount: 50, midpoint: 0, feather: 0 }, source);
	close(light[0]!, decode(0.625)); close(light[4]!, decode(0.875));
	const protectedOutput = await run('post-crop-vignette-v1', { amount: -100, midpoint: 0, feather: 0, highlights: 100 }, new Float32Array([decode(-0.5), decode(2), 0.25, 1, decode(-0.5), decode(2), 0.25, 1]));
	// Both natural width2 centers have full coverage, but the HDR maximum fully protects them.
	close(protectedOutput[0]!, decode(-0.5)); close(protectedOutput[1]!, decode(2));
});

test('ordered spatial stages use the incoming stage rather than a retained original neighborhood', async () => {
	const values = Array<number>(49).fill(0.25); values[24] = 0.5; const source = gray(values);
	const clarityThenFog = await run('dehaze-v1', { amount: -100 }, await run('clarity-v1', { amount: 100 }, source, 7, 7), 7, 7);
	const fogThenClarity = await run('clarity-v1', { amount: 100 }, await run('dehaze-v1', { amount: -100 }, source, 7, 7), 7, 7);
	close(clarityThenFog[96]!, decode(0.86279296875));
	close(fogThenClarity[96]!, decode(0.75 + 0.11279296875 * (127.5 / 254)));
	assert.notEqual(clarityThenFog[96], fogThenClarity[96]);
});

test('grain keeps deterministic lattice, current-stage size/roughness and sub-byte offset precision', async () => {
	const source = gray(Array<number>(16).fill(0.5));
	const first = await run('grain-v1', { amount: 0.5, seed: 23, size: 2.25, roughness: 75 }, source, 4, 4);
	assert.deepEqual(first, await run('grain-v1', { amount: 0.5, seed: 23, size: 2.25, roughness: 75 }, source, 4, 4));
	assert.notDeepEqual(first, source); assert.notDeepEqual(first, await run('grain-v1', { amount: 0.5, seed: 24, size: 2.25, roughness: 75 }, source, 4, 4));
	assert.ok(first.some((value, index) => index % 4 !== 3 && Math.abs(encode(value) * 255 - 127.5) > 0 && Math.abs(encode(value) * 255 - 127.5) < 1));
	for (let index = 0; index < first.length; index += 4) { assert.equal(first[index], first[index + 1]); assert.equal(first[index], first[index + 2]); assert.equal(first[index + 3], 1); }
});

test('spatial kernels preserve exact transparent hidden RGB, alpha and admitted neutral stages', async () => {
	const source = new Float32Array([-1, 3, 1e-30, 0, 0.125, 0.25, 0.5, 0.375]);
	for (const [type, params] of [['detail-sharpen-v1', { amount: 100 }], ['clarity-v1', { amount: 100 }], ['noise-reduction-v1', { luminance: 100, color: 100 }],
		['grain-v1', { amount: 100 }], ['texture-v1', { amount: 100 }], ['dehaze-v1', { amount: 100 }], ['post-crop-vignette-v1', { amount: 100 }]] as const) {
		const output = await run(type, params, source); assert.deepEqual(output.slice(0, 4), source.slice(0, 4)); assert.equal(output[7], source[7]);
		const inactive = prepareLinearSpatialEffectV1(effect(type, params, false), descriptor(2));
		const target = new Float32Array(source.length);
		await writeLinearSpatialEffectV1(inactive, source, target, new Uint8Array(inactive.scratchBytes)); assert.deepEqual(target, source);
	}
});

test('continuous spatial stages compare to unchanged byte owners on bounded unclipped inputs', async () => {
	const cases = [
		['detail-sharpen-v1', { amount: 25 }, withDetailSharpenPixelFrameV1, 2],
		['clarity-v1', { amount: 25 }, withClarityPixelFrameV1, 2],
		['noise-reduction-v1', { luminance: 30, color: 25, luminanceDetail: 0, colorDetail: 0 }, withNoiseReductionPixelFrameV1, 4],
		['grain-v1', { amount: 25, seed: 23 }, withGrainPixelFrameV1, 2],
		['texture-v1', { amount: 25 }, withTexturePixelFrameV1, 2],
		['dehaze-v1', { amount: -30 }, withDehazePixelFrameV1, 2],
		['post-crop-vignette-v1', { amount: 25 }, withPostCropVignettePixelFrameV1, 2],
	] as const;
	const values = Array.from({ length: 25 }, (_, index) => [96 + index % 3 * 8, 112 + index % 5 * 4, 144 - index % 3 * 8, 255]).flat();
	const source = new Float32Array(values.map((value, index) => index % 4 === 3 ? value / 255 : decode(value / 255)));
	for (const [type, params, owner, tolerance] of cases) {
		const output = await run(type, params, source, 5, 5);
		const baseline = await owner({ frame: { descriptor: { ...descriptor(5, 5), sampleFormat: 'unorm8', transfer: 'srgb' }, pixels: new Uint8Array(values) }, effect: effect(type, params) }, frame => [...frame.pixels], { limits: LIMITS });
		for (let index = 0; index < output.length; index++) if (index % 4 !== 3) assert.ok(Math.abs(Math.floor(encode(output[index]!) * 255 + 0.5) - baseline[index]!) <= tolerance, `${type} sample${String(index)}`);
	}
});

test('admission owns effect identity/extent and refuses malformed inactive parameters or aliased native planes', async () => {
	let reads = 0;
	const params = Object.defineProperty({}, 'amount', { enumerable: true, get() { reads++; return 0; } });
	assert.throws(() => prepareLinearSpatialEffectV1(effect('clarity-v1', params, false), descriptor(1))); assert.equal(reads, 0);
	assert.throws(() => prepareLinearSpatialEffectV1(effect('grain-v1', { seed: 0.1 }, false), descriptor(1)));
	assert.throws(() => prepareLinearSpatialEffectV1(effect('tone-ladder-v1'), descriptor(1)));
	const plan = prepareLinearSpatialEffectV1(effect('clarity-v1', { amount: 50 }), descriptor(1)), source = gray([0.5]);
	assert.ok(Object.isFrozen(plan)); assert.equal(plan.scratchBytes, 0);
	await assert.rejects(writeLinearSpatialEffectV1({ ...plan }, source, new Float32Array(4), new Uint8Array(0)), /owning/u);
	await assert.rejects(writeLinearSpatialEffectV1(plan, source, source, new Uint8Array(0)));
	await assert.rejects(writeLinearSpatialEffectV1(plan, source, new Float32Array(4), new Uint8Array(1)));
	await assert.rejects(writeLinearSpatialEffectV1(plan, new Float32Array([NaN, 0, 0, 1]), new Float32Array(4), new Uint8Array(0)));
});

test('spatial identity is captured before parameter admission can reenter and replace the raw id', () => {
	const input = effect('clarity-v1', { amount: 50 }); let reentered = false;
	input.params = new Proxy(input.params, { getOwnPropertyDescriptor(target, key) {
		reentered = true; input.id = 'x'.repeat(129); return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	const plan = prepareLinearSpatialEffectV1(input, descriptor(1));
	assert.equal(reentered, true); assert.equal(input.id.length, 129); assert.equal(plan.id, 'clarity-v1');
});

test('real task cancellation retains opaque identity and pinned native detachment refuses further writes', async () => {
	for (const detach of [false, true]) {
		const source = gray(Array<number>(128 * 128).fill(0.5)), before = source.slice(), target = new Float32Array(source.length);
		const controller = new AbortController(), reason = Object.create(null) as object;
		const plan = prepareLinearSpatialEffectV1(effect('clarity-v1', { amount: 50 }), descriptor(128, 128));
		setTimeout(() => { if (detach) structuredClone(source.buffer, { transfer: [source.buffer] }); else controller.abort(reason); }, 0);
		let rejected = false;
		try { await writeLinearSpatialEffectV1(plan, source, target, new Uint8Array(0), controller.signal); }
		catch (error) { rejected = true; if (!detach) assert.equal(error, reason); }
		assert.equal(rejected, true); if (!detach) assert.deepEqual(source, before);
	}
});
