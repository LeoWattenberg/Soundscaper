/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEHAZE_PROCESS_V1, DEHAZE_EFFECT_CODE_V1, DEHAZE_VIDEO_EFFECT_DEFINITION_V1, normalizeDehazeParamsV1,
	normalizeDehazeEffectV1, prepareDehazeEffectV1, dehazeEffectiveDarkByteV1, dehazeTransmissionQ8V1, dehazeOutputByteV1,
	dehazePreviewPassV1 } from '../src/common/editor/video-dehaze-v1.ts';
import { withDehazePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-dehaze-v1.ts';
import { DEHAZE_GLSL_V1 } from '../src/common/editor/ui/video-preview-dehaze-v1.ts';
import { DEHAZE_SOURCE_V1, DEHAZE_GOLDENS_V1, dehazeReferenceV1 } from './helpers/video-dehaze-reference.ts';

const effect = (amount = 100) => ({ id: 'dehaze', type: 'dehaze-v1', enabled: true, params: { amount } });
const limits = { maximumSidePixels: 1024, maximumPixels: 262144, maximumBytes: 1048576 };
const frame = (pixels: Uint8Array, width: number) => ({ descriptor: { schemaVersion: 1, width, height: pixels.length / (4 * width),
	sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels });
const execute = (pixels: Uint8Array, width: number, amount: number) =>
	withDehazePixelFrameV1({ frame: frame(pixels, width), effect: effect(amount) }, value => [...value.pixels], { limits });

test('Dehaze closes its versioned fractional amount, immutable preparation and reserved shader33', () => {
	assert.equal(DEHAZE_PROCESS_V1, 'srgb-alpha-dark3-white-dehaze-q8-v1'); assert.equal(DEHAZE_EFFECT_CODE_V1, 33);
	assert.equal(DEHAZE_VIDEO_EFFECT_DEFINITION_V1.type, 'dehaze-v1'); assert.deepEqual(normalizeDehazeParamsV1(undefined), { amount: 0 });
	const raw = effect(37.125), admitted = normalizeDehazeEffectV1(raw); raw.params.amount = -100;
	assert.equal(admitted.params.amount, 37.125); assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.params));
	assert.equal(prepareDehazeEffectV1(admitted).gainQ8, 95); assert.equal(prepareDehazeEffectV1(effect(-37.125)).gainQ8, -95);
	assert.equal(Object.is(prepareDehazeEffectV1(effect(-0.1)).gainQ8, -0), false);
	for (const amount of [-100.001, 100.001, NaN, Infinity, '1']) assert.throws(() => normalizeDehazeParamsV1({ amount }));
	for (const params of [null, [], { amount: 0, extra: 1 }]) assert.throws(() => normalizeDehazeParamsV1(params));
	let reads = 0; const getter = Object.defineProperty({}, 'amount', { enumerable: true, get() { reads++; return 1; } });
	assert.throws(() => normalizeDehazeParamsV1(getter)); assert.equal(reads, 0);
	for (const bad of [{ ...effect(0), type: 'dehaze-v2' }, { ...effect(0), params: undefined }, { ...effect(0), id: 'x'.repeat(129) },
		{ ...effect(0), enabled: 1 }, { ...effect(0), future: 1 }, { ...effect(101), enabled: false }]) assert.throws(() => normalizeDehazeEffectV1(bad));
	assert.deepEqual(dehazePreviewPassV1(effect(50))?.params0, [128,0,0,0]); assert.equal(dehazePreviewPassV1(effect(50))?.code, 33);
	assert.equal(dehazePreviewPassV1(effect(0)), null); assert.equal(dehazePreviewPassV1({ ...effect(), enabled: false }), null);
	assert.match(DEHAZE_GLSL_V1, /texelFetch/); assert.match(DEHAZE_GLSL_V1, /65280/);
});

test('owning transmission floors amplification and signed rational ties independently of caller lookalikes', () => {
	const prepared = prepareDehazeEffectV1(effect());
	assert.equal(dehazeTransmissionQ8V1(prepared, 0), 256); assert.equal(dehazeTransmissionQ8V1(prepared, 255), 26);
	assert.equal(dehazeOutputByteV1(prepared, 0, 256), 0); assert.equal(dehazeOutputByteV1(prepared, 255, 26), 255);
	// Transmission128 makes reconstruction exact; transmission256 leaves bytes unchanged.
	assert.equal(dehazeOutputByteV1(prepared, 192, 128), 129); assert.equal(dehazeOutputByteV1(prepared, 192, 256), 192);
	// Reachable integer transmissions straddle the negative -1.5 boundary.
	assert.equal(dehazeOutputByteV1(prepared, 254, 171), 254); assert.equal(dehazeOutputByteV1(prepared, 254, 170), 253);
	assert.throws(() => dehazeTransmissionQ8V1({ ...prepared }, 64)); assert.throws(() => dehazeOutputByteV1({ ...prepared }, 64, 196));
	assert.equal(dehazeEffectiveDarkByteV1(0,0,0,0), 255); assert.equal(dehazeEffectiveDarkByteV1(0,0,0,1), 254);
	assert.equal(dehazeEffectiveDarkByteV1(64,96,128,255), 64);
	assert.equal(255 * 256 * 243, 15863040); assert.ok(15863040 < 2 ** 24);
});

test('literal atmospheric goldens remove a white veil or add a veil with fractional amounts and exact source retention', async () => {
	const source = new Uint8Array(DEHAZE_SOURCE_V1);
	for (const [amount, expected] of DEHAZE_GOLDENS_V1) {
		assert.deepEqual(dehazeReferenceV1(source, 2, amount), expected);
		assert.deepEqual(await execute(source, 2, amount), expected);
	}
	assert.deepEqual([...source], DEHAZE_SOURCE_V1);
	assert.ok(DEHAZE_GOLDENS_V1[0][1][2] - DEHAZE_GOLDENS_V1[0][1][0] > source[2]! - source[0]!);
	assert.ok(DEHAZE_GOLDENS_V1[3][1][2] - DEHAZE_GOLDENS_V1[3][1][0] < source[2]! - source[0]!);
});

test('independent BigInt neighborhoods preserve all256 alpha and hidden RGB through signed and repeated stages', async () => {
	const source = new Uint8Array(Array.from({ length: 256 }, (_, n) => [64 + n % 128,80 + (n * 17) % 160,96 + (n * 31) % 160,n]).flat());
	for (const amount of [-100,100,37.125,-37.125,0]) {
		const output = await execute(source, 16, amount); assert.deepEqual(output, dehazeReferenceV1(source, 16, amount));
		assert.deepEqual(output.filter((_, n) => n % 4 === 3), Array.from({ length: 256 }, (_, n) => n)); assert.deepEqual(output.slice(0,4), [...source.slice(0,4)]);
	}
	for (const stages of [[37.125,-50],[-50,37.125],[100,100]]) {
		let cpu = [...source], expected = [...source];
		for (const amount of stages) { cpu = await execute(new Uint8Array(cpu), 16, amount); expected = dehazeReferenceV1(expected, 16, amount); }
		assert.deepEqual(cpu, expected);
	}
	const forward = await execute(new Uint8Array(await execute(source,16,37.125)),16,-50);
	const reverse = await execute(new Uint8Array(await execute(source,16,-50)),16,37.125); assert.notDeepEqual(forward, reverse);
});

test('replicated two-dimensional edges, hidden black neighbors and nearly transparent neighbors have explicit influence', async () => {
	const center = [128,160,192,255], hidden = new Uint8Array([0,0,0,0,...center,255,0,255,0]);
	assert.deepEqual(await execute(hidden,3,100), dehazeReferenceV1(hidden,3,100));
	const hiddenOutput = await execute(hidden,3,100); assert.deepEqual(hiddenOutput.slice(0,4), [0,0,0,0]);
	const visible = new Uint8Array(hidden); visible[3] = 255; assert.deepEqual(await execute(visible,3,100), [...visible]);
	const nearly = new Uint8Array(hidden); nearly[3] = 1;
	assert.deepEqual((await execute(nearly,3,100)).slice(4,8), hiddenOutput.slice(4,8));
	const matrix = new Uint8Array([96,112,128,255,160,192,224,255,64,96,128,127,208,192,160,255,128,160,192,175,224,240,248,255]);
	assert.deepEqual(await execute(matrix,3,100), dehazeReferenceV1(matrix,3,100));
	const highDark = new Uint8Array([255,255,255,255,254,254,254,255,100,100,100,1]);
	assert.deepEqual(await execute(highDark,3,100), [255,255,255,255,245,245,245,255,0,0,0,1]);
	const whiteNeighbor = new Uint8Array(hidden); whiteNeighbor.set([255,255,255,255],0); whiteNeighbor.set([255,255,255,255],8);
	assert.deepEqual((await execute(whiteNeighbor,3,100)).slice(4,8), hiddenOutput.slice(4,8));
	for (const width of [1,4]) {
		const extremes = new Uint8Array([0,0,0,255,255,255,255,255,0,128,255,255,92,173,214,0]);
		assert.deepEqual(await execute(extremes,width,100), [...extremes]);
	}
});

test('seeded independent tiny fixtures include spatial variation, alpha and quantization half boundaries', async () => {
	let state = 8675309; const next = () => { state = (state * 48271) % 2147483647; return state; };
	for (let n = 0; n < 49; n++) {
		const width = 1 + n % 7, height = 1 + Math.floor(n / 7), source = new Uint8Array(width * height * 4);
		for (let i = 0; i < source.length; i++) source[i] = i % 4 === 3 ? next() % 256 : 48 + next() % 208;
		const amount = n % 2 === 0 ? (next() % 25600) / 256 : -(next() % 25600) / 256;
		assert.deepEqual(await execute(source,width,amount), dehazeReferenceV1(source,width,amount));
	}
	const source = new Uint8Array(DEHAZE_SOURCE_V1);
	for (const q of [-255,-128,-1,0,1,127,255]) {
		const halfway = (q + 0.5) * 100 / 256;
		for (const amount of [halfway - Number.EPSILON * Math.max(1,Math.abs(halfway)),halfway,halfway + Number.EPSILON * Math.max(1,Math.abs(halfway))]) {
			assert.deepEqual(await execute(source,2,amount), dehazeReferenceV1(source,2,amount));
		}
	}
});
