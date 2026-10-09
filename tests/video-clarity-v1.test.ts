/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { CLARITY_PROCESS_V1, normalizeClarityParamsV1, normalizeClarityEffectV1, prepareClarityEffectV1,
	clarityAdjustmentV1, clarityPreviewPassV1, serializeClarityEffectToFfmpegV1 } from '../src/common/editor/video-clarity-v1.ts';
import { withClarityPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-clarity-v1.ts';
import { videoEffectPasses, EFFECT_CODES, EFFECT_PROGRAM_COUNT } from '../src/common/editor/ui/video-preview-effects.js';
import { CLARITY_GLSL_V1 } from '../src/common/editor/ui/video-preview-clarity-v1.ts';

const effect = (amount: number) => ({ id: 'clarity', type: 'clarity-v1', enabled: true, params: { amount } });
const limits = { maximumSidePixels: 16, maximumPixels: 256, maximumBytes: 1024 };
const frame = (pixels: Uint8Array, width: number) => ({ descriptor: { schemaVersion: 1, width, height: pixels.length / (4 * width),
	sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels });

test('Clarity owns closed immutable amount, process, prepared Q8 and exact shader29 admission', () => {
	assert.equal(CLARITY_PROCESS_V1, 'srgb-alpha-binomial7-luma-clarity-q8-v1');
	assert.deepEqual(normalizeClarityParamsV1(undefined), { amount: 0 });
	const raw = effect(37.125), admitted = normalizeClarityEffectV1(raw); raw.params.amount = -100;
	assert.equal(admitted.params.amount, 37.125); assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.params));
	assert.equal(prepareClarityEffectV1(admitted).gainQ8, 95);
	for (const amount of [-100.001, 100.001, NaN, Infinity, '1']) assert.throws(() => normalizeClarityParamsV1({ amount }));
	for (const params of [null, [], { amount: 0, extra: 1 }]) assert.throws(() => normalizeClarityParamsV1(params));
	let reads = 0; const getter = Object.defineProperty({}, 'amount', { enumerable: true, get() { reads++; return 1; } });
	assert.throws(() => normalizeClarityParamsV1(getter)); assert.equal(reads, 0);
	for (const bad of [{ ...effect(0), type: 'clarity-v2' }, { ...effect(0), params: undefined }, { ...effect(0), id: 'x'.repeat(129) }]) assert.throws(() => normalizeClarityEffectV1(bad));
	assert.deepEqual(clarityPreviewPassV1(effect(50))?.params0, [128,0,0,0]); assert.equal(clarityPreviewPassV1(effect(50))?.code, 29);
	assert.equal(EFFECT_CODES['clarity-v1'],29);assert.equal(EFFECT_PROGRAM_COUNT,34);
	assert.deepEqual(videoEffectPasses(null),[]);assert.deepEqual(videoEffectPasses(undefined),[]);
	assert.deepEqual(videoEffectPasses(effect(50)),[clarityPreviewPassV1(effect(50))]);
	assert.equal(clarityPreviewPassV1(effect(0)), null); assert.equal(serializeClarityEffectToFfmpegV1(effect(0)), null);
	assert.equal(clarityPreviewPassV1({ ...effect(100), enabled: false }), null);
	const operation = serializeClarityEffectToFfmpegV1(effect(-50))!;
	assert.equal(operation.kind, 'clarity-v1'); assert.equal(operation.preserveAlpha, true); assert.match(operation.expression, /interpolation=nearest/);
	assert.match(CLARITY_GLSL_V1, /texelFetch/); assert.match(CLARITY_GLSL_V1, /65024/);
});

test('midtone signed half ties round toward positive infinity while black and white remain protected', () => {
	const half = prepareClarityEffectV1(effect(50)), negative = prepareClarityEffectV1(effect(-50));
	assert.equal(clarityAdjustmentV1(half, 127, 126 * 2, 2), 1);
	assert.equal(clarityAdjustmentV1(half, 127, 128 * 2, 2), 0);
	assert.equal(clarityAdjustmentV1(negative, 127, 126 * 3, 3), 0);
	assert.equal(clarityAdjustmentV1(negative, 127, 128 * 3, 3), 1);
	assert.equal(clarityAdjustmentV1(half, 0, 255, 1), 0); assert.equal(clarityAdjustmentV1(half, 255, 0, 1), 0);
	assert.equal(clarityAdjustmentV1(half, 127, 0, 0), 0);
	assert.throws(() => clarityAdjustmentV1({ ...half }, 127, 252, 2));
});

test('dense seven-bin local contrast has independent positive, softening and fractional gradient goldens', async () => {
	const pixels = new Uint8Array([64,64,64,255,128,128,128,255,192,192,192,255]);
	for (const [amount, expected] of [[100,[49,128,206]],[-100,[79,128,178]],[50,[57,128,199]],[37.125,[59,128,197]]] as const) {
		const output = await withClarityPixelFrameV1({ frame: frame(pixels, 3), effect: effect(amount) }, view => [...view.pixels], { limits });
		assert.deepEqual(output, expected.flatMap(value => [value,value,value,255]));
	}
	assert.deepEqual([...pixels], [64,64,64,255,128,128,128,255,192,192,192,255]);
});

test('independent BigInt neighborhoods qualify all256 alpha, common-color offsets, clipping and hidden RGB', async () => {
	const pixels = new Uint8Array(Array.from({ length: 256 }, (_, n) => [n,255-n,(n*17)%256,n]).flat());
	for (const amount of [-100, 100, 37.125, 0]) {
		const output = await withClarityPixelFrameV1({ frame: frame(pixels,16), effect: effect(amount) }, view => [...view.pixels], { limits });
		assert.deepEqual(output, reference(pixels,16,amount));
		assert.deepEqual(output.filter((_, n) => n%4 === 3), Array.from({ length: 256 }, (_, n) => n));
	}
	const hidden = new Uint8Array([255,0,255,0,64,128,192,127,0,255,0,0]);
	assert.deepEqual(await withClarityPixelFrameV1({ frame: frame(hidden,3), effect: effect(100) }, view => [...view.pixels], { limits }), [...hidden]);
});

// Independent integer oracle: literal binomial coefficients, byte luma,
// full49 source addresses and explicit signed rational nearest rounding.
function reference(source: Uint8Array, width: number, amount: number): number[] {
	const height = source.length / (4 * width), bins = [1n,6n,15n,20n,15n,6n,1n], gain = BigInt(Math.round(amount*256/100));
	const luma = (n: number) => (54n*BigInt(source[n]!)+183n*BigInt(source[n+1]!)+19n*BigInt(source[n+2]!)+128n)/256n;
	return [...source].map((byte, offset) => {
		const c = offset%4, p = Math.floor(offset/4); if (c===3 || source[p*4+3]===0) return byte;
		const x=p%width,y=Math.floor(p/width); let sum=0n,weight=0n;
		for(let row=0;row<7;row++)for(let column=0;column<7;column++){
			const n=4*(Math.min(height-1,Math.max(0,y+row-3))*width+Math.min(width-1,Math.max(0,x+column-3)));
			const w=bins[row]!*bins[column]!*BigInt(source[n+3]!);weight+=w;sum+=w*luma(n);
		}
		const original=luma(p*4),blur=(2n*sum+weight)/(2n*weight),mid=2n*(original<255n-original?original:255n-original);
		const numerator=(original-blur)*gain*mid+32512n,adjustment=numerator>=0n?numerator/65024n:-((-numerator+65023n)/65024n);
		const output=BigInt(byte)+adjustment;return Number(output<0n?0n:output>255n?255n:output);
	});
}
