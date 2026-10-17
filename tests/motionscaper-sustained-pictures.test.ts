/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { crc32, deflateSync } from 'node:zlib';
import type { CanvasKit } from 'canvaskit-wasm';
import { compareMotionSustainedNative, compareMotionSustainedRgba, decodeMotionSustainedPng, motionSustainedWebmReference, prepareMotionSustainedPictures } from '../scripts/performance/motionscaper-sustained-pictures.ts';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';

const srgb = (v: number) => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
const rec709 = (v: number) => v < .018 ? 4.5 * v : 1.099 * v ** .45 - .099;
function reference() {
	const surface = createMotionSurface(160, 90, [.25, .125, .5, .5]);
	surface.pixels.set([0, 0, 0, 0], 0); surface.pixels.set([.25, .125, .5, 1], 4);
	return surface;
}
function preview() {
	const surface = reference(), bytes = new Uint8Array(surface.pixels.length);
	for (let i = 0; i < bytes.length; i += 4) {
		const alpha = surface.pixels[i + 3]!; bytes[i + 3] = Math.round(alpha * 255);
		for (let c = 0; c < 3; c++) bytes[i + c] = alpha ? Math.round(255 * srgb(surface.pixels[i + c]! / alpha)) : 0;
	}
	return bytes;
}
function native() {
	const surface = reference(), bytes = new Float32Array(surface.pixels.length);
	for (let i = 0; i < bytes.length; i += 4) {
		const alpha = surface.pixels[i + 3]!; bytes[i + 3] = alpha;
		for (let c = 0; c < 3; c++) bytes[i + c] = alpha ? rec709(surface.pixels[i + c]! / alpha) : .7;
	}
	return bytes;
}
test('Motion sustained selected preview/PNG comparisons keep exact alpha and one premultiplied code', () => {
	const surface = reference(), bytes = preview();
	assert.equal(compareMotionSustainedRgba(bytes, surface).maximumPremultipliedError, 0);
	bytes[8]! += 1; assert.ok(compareMotionSustainedRgba(bytes, surface).maximumPremultipliedError < 1);
	bytes[8]! += 1; assert.throws(() => compareMotionSustainedRgba(bytes, surface), /premultiplied/u);
	bytes[8]! -= 2; bytes[11]! -= 1; assert.throws(() => compareMotionSustainedRgba(bytes, surface), /alpha/u);
	assert.throws(() => compareMotionSustainedRgba(bytes.subarray(4), surface), /geometry/u);
	assert.throws(() => compareMotionSustainedRgba(preview(), createMotionSurface(160, 89)), /geometry/u);
});
test('Motion sustained native compares straight Rec709 with exact alpha endpoints and declared ten-bit bounds', () => {
	const surface = reference(), bytes = native();
	assert.ok(compareMotionSustainedNative(bytes, surface).maximumColorError < 1e-7);
	bytes[8]! += 7 / 1023; bytes[11]! += 1 / 1023;
	const accepted = compareMotionSustainedNative(bytes, surface); assert.ok(accepted.maximumColorError < 8 / 1023); assert.ok(accepted.maximumAlphaError < 2 / 1023);
	bytes[8]! += 2 / 1023; assert.throws(() => compareMotionSustainedNative(bytes, surface), /color/u);
	bytes[8]! -= 2 / 1023; bytes[11]! += 2 / 1023; assert.throws(() => compareMotionSustainedNative(bytes, surface), /alpha/u);
	for (const offset of [3, 7]) { const bad = native(); bad[offset] = offset === 3 ? .00001 : .99999; assert.throws(() => compareMotionSustainedNative(bad, surface), /endpoint/u); }
	const nonfinite = native(); nonfinite[0] = NaN; assert.throws(() => compareMotionSustainedNative(nonfinite, surface), /finite/u);
	assert.throws(() => compareMotionSustainedNative(native().subarray(4), surface), /geometry/u);
});
test('Motion sustained opaque WebM reference flattens premultiplied linear light before Rec709 encoding', () => {
	const surface = reference(), bytes = motionSustainedWebmReference(surface);
	assert.deepEqual(Array.from(bytes.subarray(0, 4)), [0, 0, 0, 255]);
	assert.deepEqual(Array.from(bytes.subarray(8, 12)), [Math.round(255 * rec709(.125)), Math.round(255 * rec709(.0625)), Math.round(255 * rec709(.25)), 255]);
	assert.notEqual(bytes[8], Math.round(255 * srgb(.125))); assert.notEqual(bytes[8], Math.round(255 * rec709(.25) * .5));
	assert.ok(bytes.every((byte, index) => index % 4 !== 3 || byte === 255));
});
test('Motion sustained picture preparation refuses non-plan geometry/ranges before runtime initialization', async () => {
	const project = createMotionscaperProject({ id: 'test', compositionId: 'main', title: 'Test', width: 1, height: 1, durationFrames: 1200 });
	await assert.rejects(prepareMotionSustainedPictures({ project, bodies: new Map(), frames: 300, root: '/runtime-must-not-load' }), /geometry/u);
	await assert.rejects(prepareMotionSustainedPictures({ project, bodies: new Map(), frames: 400 as 300, root: '/runtime-must-not-load' }), /range/u);
});

test('Motion sustained selected PNG decoding releases its native image on success and failure without retaining native pixels', () => {
	function chunk(type: string, body: Uint8Array) {
		const bytes = Buffer.alloc(body.length + 12); bytes.writeUInt32BE(body.length); bytes.write(type, 4); bytes.set(body, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
	}
	const header = Buffer.alloc(13); header.writeUInt32BE(160); header.writeUInt32BE(90, 4); header[8] = 8; header[9] = 6;
	const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(90 * 641))), chunk('IEND', new Uint8Array())]);
	let released = 0, created = 0, fail = false; const source = new Uint8Array(160 * 90 * 4);
	const kit = { ColorType: { RGBA_8888: 1 }, AlphaType: { Unpremul: 2 }, ColorSpace: { SRGB: 3 }, MakeImageFromEncoded() {
		created++; return { width: () => 160, height: () => 90, readPixels(_x: number, _y: number, info: unknown) {
			assert.deepEqual(info, { width: 160, height: 90, colorType: 1, alphaType: 2, colorSpace: 3 });
			if (fail) throw new Error('fixture native read failed'); return source;
		}, delete() { released++; source.fill(255); } };
	} } as unknown as CanvasKit;
	const decoded = decodeMotionSustainedPng(kit, png); assert.equal(created, 1); assert.equal(released, 1); assert.equal(decoded[0], 0);
	fail = true; assert.throws(() => decodeMotionSustainedPng(kit, png), /fixture native/u); assert.equal(released, 2);
	const corrupt = Buffer.from(png); corrupt[29]! ^= 1; assert.throws(() => decodeMotionSustainedPng(kit, corrupt), /CRC/u); assert.equal(created, 2);
	assert.throws(() => decodeMotionSustainedPng(kit, png.subarray(0, 20)), /admission/u); assert.equal(created, 2);
});
