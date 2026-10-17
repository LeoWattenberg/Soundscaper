/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { CHROMA_DEVELOP_PROCESS_V1, normalizeChromaDevelopEffectV1, prepareChromaDevelopEffectV1,
	applyChromaDevelopPixelV1, chromaDevelopPreviewPassV1 } from '../src/common/editor/video-chroma-develop-v1.ts';

const effect = (params = {}, enabled = true) => ({ id: 'chroma', type: 'chroma-v1', enabled, params });
const SOURCE = [0,32,64,0,64,128,192,1,128,128,128,127,255,224,16,255];
function render(params = {}, source = SOURCE, enabled = true) {
	const prepared = prepareChromaDevelopEffectV1(effect(params, enabled)), pixels = new Uint8Array(source);
	for (let offset = 0; offset < pixels.length; offset += 4) applyChromaDevelopPixelV1(prepared, pixels, offset);
	return Array.from(pixels);
}

test('chroma version1 owns encoded-sRGB Q16 math and independent saturation/vibrance byte goldens', () => {
	assert.equal(CHROMA_DEVELOP_PROCESS_V1, 'srgb-chroma-q16-v1');
	assert.deepEqual(render({ saturation: -100 }), [28,28,28,0,119,119,119,1,128,128,128,127,215,215,215,255]);
	assert.deepEqual(render({ saturation: 100 }), [0,36,100,0,9,137,255,1,128,128,128,127,255,233,0,255]);
	assert.deepEqual(render({ vibrance: 100 }, [64,128,192,127,100,110,120,1,255,0,0,0]), [37,132,228,127,92,111,130,1,255,0,0,0]);
	assert.deepEqual(render({ vibrance: -100 }, [100,110,120,255]), [108,109,110,255]);
	assert.deepEqual(render({ saturation: -100, vibrance: 100 }), [28,28,28,0,119,119,119,1,128,128,128,127,215,215,215,255]);
});

test('neutral/disabled chroma preserves every gray byte and alpha while prepared settings detach', () => {
	const gray = Array.from({ length: 256 }, (_, n) => [n,n,n,n]).flat();
	assert.deepEqual(render({}, gray), gray); assert.deepEqual(render({ saturation: 100, vibrance: -100 }, gray, false), gray);
	assert.equal(chromaDevelopPreviewPassV1(effect()), null);
	const input = effect({ saturation: 12.5, vibrance: -37.125 }), prepared = prepareChromaDevelopEffectV1(input);
	assert.equal(Reflect.set(input.params,'saturation',100),true);
	assert.deepEqual(prepared.params0, [73728,-24330,0,0]);
	assert.ok(Object.isFrozen(prepared.params0)); assert.ok(Object.isFrozen(prepared));
});

test('all256 multichannel samples agree with an independent integer reference for fractional parameters', () => {
	const source = Array.from({ length: 256 }, (_, n) => [n,(17*n)%256,255-n,[0,1,127,255][n%4]!]).flat();
	for (const [saturation, vibrance] of [[100,100],[-100,-100],[12.5,-37.125],[-33.3,73.25],[0,100]]) {
		const expected: number[] = [];
		for (let i = 0; i < source.length; i += 4) expected.push(...reference(source.slice(i,i+3), saturation!, vibrance!), source[i+3]!);
		assert.deepEqual(render({ saturation, vibrance }, source), expected);
	}
});

test('chroma admission rejects hostile accessors, future fields, invalid ranges and unbounded IDs without getters', () => {
	let reads = 0;
	const accessor = Object.defineProperty({}, 'saturation', { enumerable: true, get() { reads++; return 0; } });
	for (const input of [{ ...effect(), future: 1 }, { ...effect(), type: 'chroma-v2' }, { ...effect(), id: 'x'.repeat(129) },
		{ ...effect(), enabled: 0 }, effect({ saturation: 100.01 }), effect({ vibrance: NaN }), effect({ future: 0 }), effect(accessor)]) {
		assert.throws(() => normalizeChromaDevelopEffectV1(input));
	}
	assert.equal(reads, 0);
	const normalized = normalizeChromaDevelopEffectV1(effect()); assert.deepEqual(normalized.params, { saturation: 0, vibrance: 0 });
	assert.ok(Object.isFrozen(normalized.params));
});

// Independently evaluate integer algebra with BigInt division; no production math helper is borrowed.
function reference(input: number[], saturation: number, vibrance: number): number[] {
	const Q = 65536n, sat = BigInt(Math.round((1+saturation/100)*65536)), vib = BigInt(Math.round(vibrance/100*65536));
	const step = (rgb: bigint[], factor: bigint) => {
		const y = (54n*rgb[0]!+183n*rgb[1]!+19n*rgb[2]!+128n)/256n;
		return rgb.map(c => { const value = y*Q+(c-y)*factor+Q/2n; return value <= 0n ? 0n : value >= 255n*Q ? 255n : value/Q; });
	};
	const first = step(input.map(BigInt), sat), range = first.reduce((a,b)=>a>b?a:b)-first.reduce((a,b)=>a<b?a:b);
	const numerator = vib*(255n-range)+127n;
	const offset = numerator >= 0n ? numerator/255n : -((-numerator+254n)/255n);
	return step(first,Q+offset).map(Number);
}
