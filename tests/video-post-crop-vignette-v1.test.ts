/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { POST_CROP_VIGNETTE_PROCESS_V1, normalizePostCropVignetteParamsV1, preparePostCropVignetteEffectV1,
	postCropVignetteWeightV1, postCropVignetteByteV1, postCropVignettePreviewPassV1 } from '../src/common/editor/video-post-crop-vignette-v1.ts';

const effect = (params: unknown = {}, enabled = true) => ({ id: 'vignette', type: 'post-crop-vignette-v1', enabled, params });

test('the post-crop process admits five closed finite scalars, detaches and quantizes before rendering', () => {
	assert.equal(POST_CROP_VIGNETTE_PROCESS_V1, 'srgb-natural-output-vignette-q8-v1');
	assert.deepEqual(normalizePostCropVignetteParamsV1(undefined), { amount: 0, midpoint: 50, roundness: 0, feather: 50, highlights: 0 });
	const raw = { amount: -37.125, midpoint: 25, roundness: -50, feather: 0, highlights: 100 }, normalized = normalizePostCropVignetteParamsV1(raw);
	raw.amount = 0; assert.equal(normalized.amount, -37.125); assert.ok(Object.isFrozen(normalized));
	const prepared = preparePostCropVignetteEffectV1(effect(normalized));
	assert.deepEqual([prepared.amountQ8, prepared.midpointQ16, prepared.roundnessQ8, prepared.featherQ16, prepared.highlightsQ8], [-95,16384,-128,0,256]);
	for (const value of [{ amount: -100.1 }, { amount: 100.1 }, { amount: NaN }, { midpoint: 101 }, { feather: -1 }, { highlights: Infinity }, { roundness: -101 }, { future: 1 }]) assert.throws(() => normalizePostCropVignetteParamsV1(value));
	let invoked = 0; const accessor = Object.defineProperty({}, 'amount', { enumerable: true, get() { invoked++; return 100; } });
	assert.throws(() => normalizePostCropVignetteParamsV1(accessor)); assert.equal(invoked, 0);
	assert.equal(Object.is(normalizePostCropVignetteParamsV1({ amount: -0 }).amount, -0), false);
});

test('pixel centers and smoothstep have independent literal square-frame corner, edge and center goldens', () => {
	const prepared = preparePostCropVignetteEffectV1(effect({ amount: -100 }));
	const weights = Array.from({ length: 9 }, (_, n) => postCropVignetteWeightV1(prepared, 3, 3, n % 3, Math.floor(n / 3)));
	assert.deepEqual(weights, [225,0,225,0,0,0,225,0,225]);
	assert.deepEqual(weights.map(weight => postCropVignetteByteV1(prepared, 128, 128, weight)), [16,128,16,128,128,128,16,128,16]);
	assert.equal(postCropVignetteWeightV1(prepared, 1, 1, 0, 0), 0);
});

test('midpoint and feather endpoints remain defined, including a hard edge and a full fade', () => {
	const hard = preparePostCropVignetteEffectV1(effect({ amount: -100, midpoint: 0, feather: 0 }));
	assert.equal(postCropVignetteWeightV1(hard, 3, 3, 1, 1), 0); assert.equal(postCropVignetteWeightV1(hard, 3, 3, 0, 1), 256);
	const outer = preparePostCropVignetteEffectV1(effect({ amount: -100, midpoint: 100, feather: 0 }));
	assert.equal(postCropVignetteWeightV1(outer, 3, 3, 0, 0), 0); assert.equal(postCropVignetteWeightV1(outer, 4, 4, 0, 0), 256);
	const fade = preparePostCropVignetteEffectV1(effect({ amount: -100, midpoint: 0, feather: 100 }));
	assert.equal(postCropVignetteWeightV1(fade, 2, 2, 0, 0), 128);
});

test('signed amount half ties and original highlight protection have literal byte goldens', () => {
	const dark = preparePostCropVignetteEffectV1(effect({ amount: -50 })), light = preparePostCropVignetteEffectV1(effect({ amount: 50 }));
	assert.equal(postCropVignetteByteV1(dark, 1, 1, 256), 1); assert.equal(postCropVignetteByteV1(dark, 255, 255, 256), 128);
	assert.equal(postCropVignetteByteV1(light, 0, 0, 256), 128); assert.equal(postCropVignetteByteV1(light, 254, 254, 256), 255);
	const protect = preparePostCropVignetteEffectV1(effect({ amount: -100, highlights: 100 }));
	assert.equal(postCropVignetteByteV1(protect, 255, 255, 256), 255); assert.equal(postCropVignetteByteV1(protect, 128, 128, 256), 65);
	const brightProtected = preparePostCropVignetteEffectV1(effect({ amount: 100, highlights: 100 }));
	assert.equal(postCropVignetteByteV1(brightProtected, 128, 128, 256), 255, 'Highlight protection belongs to darkening only.');
});

test('all roundness extremes and extreme aspect ratios match a separate BigInt coordinate authority', () => {
	for (const [width, height] of [[3,5],[5,3],[65536,1],[1,65536],[65536,65536]]) for (const roundness of [-100,-50,0,50,100]) {
		const prepared = preparePostCropVignetteEffectV1(effect({ amount: -100, midpoint: 13.25, feather: 77.5, roundness }));
		for (const [x,y] of [[0,0],[width-1,height-1],[Math.floor(width/2),Math.floor(height/2)],[width-1,Math.floor(height/2)]]) {
			assert.equal(postCropVignetteWeightV1(prepared,width,height,x,y), independentWeight(prepared,width,height,x,y));
		}
	}
});

test('own prepared identity, coordinate limits and byte limits refuse before any evaluation', () => {
	const prepared = preparePostCropVignetteEffectV1(effect({ amount: -100 }));
	assert.throws(() => postCropVignetteWeightV1({ ...prepared },3,3,0,0));
	for (const args of [[0,3,0,0],[65537,3,0,0],[3,3,-1,0],[3,3,3,0],[3,3,0.5,0]]) assert.throws(() => postCropVignetteWeightV1(prepared,...args as [number,number,number,number]));
	for (const args of [[-1,0,0],[256,255,256],[1,256,256],[1,1,257],[1,1,0.5]]) assert.throws(() => postCropVignetteByteV1(prepared,...args as [number,number,number]));
});

test('preview planning transports only the five owning bounded integers and disables neutral stages', () => {
	const pass = postCropVignettePreviewPassV1(effect({ amount: -37.125, midpoint: 25, roundness: -50, feather: 0, highlights: 100 }));
	assert.equal(pass?.code,28); assert.deepEqual(pass?.params0,[-95,16384,0,-128]); assert.deepEqual(pass?.params1,[256,0,0,0]);
	assert.equal(postCropVignettePreviewPassV1(effect()),null); assert.equal(postCropVignettePreviewPassV1(effect({ amount: -100 },false)),null);
	assert.ok(Object.isFrozen(pass)); assert.ok(Object.isFrozen(pass?.params0));
});

function independentWeight(p: ReturnType<typeof preparePostCropVignetteEffectV1>, width: number, height: number, x: number, y: number): number {
	const floor = (a: bigint,b: bigint) => a < 0n ? -((-a+b-1n)/b) : a/b;
	const q = (position: number,size: number,denominator: number) => floor(2n*BigInt(2*position+1-size)*256n+BigInt(denominator),2n*BigInt(denominator));
	const rx=q(x,width,width),ry=q(y,height,height),ellipse=rx*rx+ry*ry,square=rx*rx>ry*ry?rx*rx:ry*ry;
	const side=Math.min(width,height),clamp=(n:bigint)=>n < -512n ? -512n : n>512n ? 512n : n;
	const cx=clamp(q(x,width,side)),cy=clamp(q(y,height,side)),rawCircle=cx*cx+cy*cy,circle=rawCircle>131072n?131072n:rawCircle;
	const r=BigInt(Math.abs(p.roundnessQ8)),other=p.roundnessQ8<0?square:circle;
	const distance=(ellipse*(256n-r)+other*r+128n)/256n;
	const span=BigInt(Math.max(1,p.featherQ16)),raw=floor((distance-BigInt(p.midpointQ16))*256n,span),t=raw<0n?0n:raw>256n?256n:raw;
	return Number((t*t*(768n-2n*t)+32768n)/65536n);
}
