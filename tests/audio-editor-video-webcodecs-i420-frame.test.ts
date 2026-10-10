/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	admitVideoWebCodecsI420Frame,
	convertVideoWebCodecsRgbaToI420,
} from '../src/common/editor/video-webcodecs-i420-frame.ts';
import { VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES } from '../src/common/editor/video-keyframe-encoder-admission.ts';

async function converted(pixels: readonly number[], width = 2, height = 2) {
	const rgba = new Uint8Array(pixels);
	const i420 = new Uint8Array(admitVideoWebCodecsI420Frame(width, height, rgba.byteLength).byteLength);
	await convertVideoWebCodecsRgbaToI420(rgba, i420, width, height);
	assert.deepEqual([...rgba], pixels);
	return [...i420];
}

for (const [name, rgb, literal] of [
	['black', [0,0,0], [16,16,16,16,128,128]],
	['white', [255,255,255], [235,235,235,235,128,128]],
	['gray', [180,180,180], [171,171,171,171,128,128]],
	['red', [255,0,0], [63,63,63,63,102,240]],
	['green', [0,255,0], [173,173,173,173,42,26]],
	['blue', [0,0,255], [32,32,32,32,240,118]],
] as const) {
	test(`BT709 limited ${name} uses independently pinned Y/U/V codes`, async () => {
		assert.deepEqual(await converted(Array.from({ length: 4 }, (_, index) => [...rgb, index * 85]).flat()), literal);
	});
}

test('asymmetric 2x2 block keeps luma order and box-averages chroma before quantization', async () => {
	assert.deepEqual(await converted([255,0,0,0, 0,255,0,64, 0,0,255,128, 255,255,255,255]), [63,173,32,235,128,128]);
	assert.deepEqual(await converted([255,0,0,255, 255,0,0,0, 0,0,0,255, 0,0,0,1]), [63,63,16,16,115,184]);
});

test('offset views leave all source bytes and destination guard bytes intact', async () => {
	const source = new Uint8Array(20).fill(71), output = new Uint8Array(10).fill(91);
	source.set([180,180,180,0, 180,180,180,255, 180,180,180,12, 180,180,180,99], 2);
	const before = source.slice();
	await convertVideoWebCodecsRgbaToI420(source.subarray(2,18), output.subarray(2,8), 2, 2);
	assert.deepEqual(source, before);
	assert.deepEqual([...output], [91,91,171,171,171,171,128,128,91,91]);
});

test('exact geometry keeps the admitted RGBA ceiling and bounds the extra plane', () => {
	assert.equal(VIDEO_KEYFRAME_ENCODER_MAXIMUM_FRAME_BYTES, 8_388_608);
	assert.deepEqual(admitVideoWebCodecsI420Frame(2048,1024,8_388_608), { byteLength: 3_145_728, rgbaByteLength: 8_388_608 });
	for (const [width,height,length] of [[1,2,8],[2,3,24],[2,2,15],[4096,4096,67_108_864],[2,2.5,20],[2,2,NaN],[32_768,2,262_144]]) {
		assert.throws(() => admitVideoWebCodecsI420Frame(width!,height!,length!));
	}
});

test('foreign, shared, resizable, detached, alias and wrong-length views refuse before writes', async () => {
	const rgba = new Uint8Array(16).fill(180), output = new Uint8Array(6).fill(91);
	const detached = new Uint8Array(16); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	for (const source of [new Uint8ClampedArray(16), new Uint8Array(new SharedArrayBuffer(16)), new Uint8Array(Reflect.construct(ArrayBuffer,[16,{maxByteLength:32}]) as ArrayBuffer), detached, {}, new Uint8Array(15)]) {
		await assert.rejects(convertVideoWebCodecsRgbaToI420(source as Uint8Array, output, 2, 2));
		assert.ok(output.every(value => value === 91));
	}
	await assert.rejects(convertVideoWebCodecsRgbaToI420(rgba, rgba.subarray(0,6), 2, 2));
	await assert.rejects(convertVideoWebCodecsRgbaToI420(rgba, new Uint8Array(5), 2, 2));
	assert.ok(rgba.every(value => value === 180));
});

test('intrinsic byte views bypass caller accessors and preserve source alpha/RGB', async () => {
	const rgba = new Uint8Array(16).fill(180), output = new Uint8Array(6);
	let reads = 0;
	for (const key of ['buffer','byteOffset','byteLength']) Object.defineProperty(rgba,key,{get(){reads++; throw Error('foreign getter');}});
	await convertVideoWebCodecsRgbaToI420(rgba, output, 2, 2);
	assert.equal(reads,0); assert.deepEqual([...output],[171,171,171,171,128,128]);
});

test('a queued task cancels bounded conversion, wipes output, and leaves source unchanged', async () => {
	const rgba = new Uint8Array(128*128*4).fill(180), output = new Uint8Array(128*128*3/2).fill(91);
	const controller = new AbortController(), reason = Symbol('queued cancel');
	const timer = setTimeout(() => controller.abort(reason),0);
	try {
		await assert.rejects(convertVideoWebCodecsRgbaToI420(rgba, output, 128,128,controller.signal), error => error === reason);
		assert.ok(output.every(value => value === 0)); assert.ok(rgba.every(value => value === 180));
	} finally { clearTimeout(timer); }
});

test('source detachment between task slices refuses and wipes the attached output', async () => {
	const rgba = new Uint8Array(128*128*4).fill(180), output = new Uint8Array(128*128*3/2).fill(91);
	const buffer = rgba.buffer;
	const timer = setTimeout(() => { structuredClone(buffer,{transfer:[buffer]}); },0);
	try {
		await assert.rejects(convertVideoWebCodecsRgbaToI420(rgba,output,128,128), /detached/u);
		assert.ok(output.every(value => value === 0));
	} finally { clearTimeout(timer); }
});
