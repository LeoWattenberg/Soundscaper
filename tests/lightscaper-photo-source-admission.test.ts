/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitPhotoSourceV1, type PhotoSourceAdmissionV1 } from '../src/lightscaper/import/photo-source-admission-v1.ts';
import { jpegExif, jpegFixture, jpegSegment, joinBytes, numberEntry, pngChunk, textEntry, tiffFixture } from './helpers/image-metadata-fixtures.ts';

const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
const GIF = new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'));
const JPEG = jpegFixture(jpegSegment(0xc0, Uint8Array.of(8, 0, 1, 0, 2, 1, 1, 0x11, 0)), jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 63, 0)), Uint8Array.of(0xff, 0, 0xff, 0xd0));
function riff(...chunks: readonly Uint8Array[]) {
	const body = joinBytes(new TextEncoder().encode('WEBP'), ...chunks), header = new Uint8Array(8);
	header.set(new TextEncoder().encode('RIFF')); new DataView(header.buffer).setUint32(4, body.length, true); return joinBytes(header, body);
}
function webpChunk(tag: string, body: Uint8Array) {
	const header = new Uint8Array(8); header.set(new TextEncoder().encode(tag)); new DataView(header.buffer).setUint32(4, body.length, true);
	return joinBytes(header, body, new Uint8Array(body.length % 2));
}
const WEBP = riff(webpChunk('VP8L', Uint8Array.of(0x2f, 0, 0, 0, 0)));
function bmp() {
	const bytes = new Uint8Array(58), view = new DataView(bytes.buffer); bytes.set([0x42, 0x4d]);
	view.setUint32(2, 58, true); view.setUint32(10, 54, true); view.setUint32(14, 40, true);
	view.setInt32(18, 1, true); view.setInt32(22, 1, true); view.setUint16(26, 1, true); view.setUint16(28, 24, true); return bytes;
}
function extendedPng(tag: string, body: Uint8Array) { return joinBytes(PNG.subarray(0, 33), pngChunk(tag, body), PNG.subarray(33)); }

test('static native structures admit only bounded sRGB-compatible inputs without decoding pixels', () => {
	for (const [bytes, format, width, height] of [[PNG, 'png', 1, 1], [JPEG, 'jpeg', 2, 1], [GIF, 'gif', 1, 1], [WEBP, 'webp', 1, 1], [bmp(), 'bmp', 1, 1]] as const) {
		assert.deepEqual(admitPhotoSourceV1(bytes), { format, width, height });
	}
});

test('a single-frame bitmap fallback cannot erase GIF, APNG or WebP animation declarations', () => {
	const descriptor = GIF.indexOf(0x2c);
	assert.throws(() => admitPhotoSourceV1(joinBytes(GIF.subarray(0, GIF.length - 1), GIF.subarray(descriptor))), /Animated GIF/u);
	assert.throws(() => admitPhotoSourceV1(extendedPng('acTL', Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 0))), /Animated PNG/u);
	const flags = new Uint8Array(10); flags[0] = 2;
	assert.throws(() => admitPhotoSourceV1(riff(webpChunk('VP8X', flags), webpChunk('VP8L', Uint8Array.of(0x2f, 0, 0, 0, 0)))), /topology/u);
	assert.throws(() => admitPhotoSourceV1(riff(webpChunk('VP8L', Uint8Array.of(0x2f, 0, 0, 0, 0)), webpChunk('ANMF', new Uint8Array()))), /animation/u);
});

test('declared profile/precision/HDR routes require later verified consumers', () => {
	for (const [tag, body] of [['iCCP', Uint8Array.of(0)], ['cICP', Uint8Array.of(9, 16, 0, 1)], ['gAMA', Uint8Array.of(0, 0, 0, 1)], ['mDCV', new Uint8Array(24)]] as const) {
		assert.throws(() => admitPhotoSourceV1(extendedPng(tag, body)));
	}
	assert.deepEqual(admitPhotoSourceV1(extendedPng('cICP', Uint8Array.of(1, 13, 0, 1))), { format: 'png', width: 1, height: 1 });
	const ihdr = PNG.slice(16, 29); ihdr[8] = 16;
	assert.throws(() => admitPhotoSourceV1(joinBytes(PNG.subarray(0, 8), pngChunk('IHDR', ihdr), PNG.subarray(33))), /precision/u);
	assert.throws(() => admitPhotoSourceV1(joinBytes(JPEG.subarray(0, 2), jpegSegment(0xe2, new TextEncoder().encode('ICC_PROFILE\0')), JPEG.subarray(2))), /profile/u);
	assert.throws(() => admitPhotoSourceV1(riff(webpChunk('VP8L', Uint8Array.of(0x2f, 0, 0, 0, 0)), webpChunk('ICCP', Uint8Array.of(0)))), /profile/u);
	assert.throws(() => admitPhotoSourceV1(riff(webpChunk('VP8L', Uint8Array.of(0x2f, 0, 0, 0, 0)), webpChunk('EXIF', Uint8Array.of(0)))), /Exif/u);
});

test('trailing images, bad metadata CRC, oversized canvases and RAW bytes cannot gain decoder authority', () => {
	assert.throws(() => admitPhotoSourceV1(joinBytes(JPEG, JPEG)), /complete image/u);
	const crc = extendedPng('eXIf', Uint8Array.of(0)); crc[41] ^= 1;
	assert.throws(() => admitPhotoSourceV1(crc), /CRC/u);
	const ihdr = PNG.slice(16, 29); new DataView(ihdr.buffer).setUint32(0, 8193);
	assert.throws(() => admitPhotoSourceV1(joinBytes(PNG.subarray(0, 8), pngChunk('IHDR', ihdr), PNG.subarray(33))), /width/u);
	assert.throws(() => admitPhotoSourceV1(Uint8Array.of(73, 73, 42, 0, 8, 0, 0, 0)), /verified static/u);
});

test('metadata byte and container work limits apply before a decoder can open', () => {
	const chunk = pngChunk('tEXt', new Uint8Array(0));
	assert.throws(() => admitPhotoSourceV1(joinBytes(PNG.subarray(0, 33), ...Array.from({ length: 4095 }, () => chunk), PNG.subarray(33))), /metadata-limit/u);
	assert.throws(() => admitPhotoSourceV1(extendedPng('tEXt', new Uint8Array(8 * 1024 * 1024))), /metadata-limit/u);
});

test('EXIF color and gamma declarations cannot borrow an unprofiled SDR route', () => {
	for (const little of [true, false]) {
		for (const entries of [[numberEntry(0xa001, 65535, little)], [numberEntry(0xa001, 2, little)], [textEntry(0xa500, 'unverified')]]) {
			const tiff = tiffFixture([], entries, little);
			assert.throws(() => admitPhotoSourceV1(joinBytes(JPEG.subarray(0, 2), jpegExif(tiff), JPEG.subarray(2))), /Exif.*colour/iu);
			assert.throws(() => admitPhotoSourceV1(extendedPng('eXIf', tiff)), /Exif.*colour/iu);
		}
		assert.deepEqual(admitPhotoSourceV1(extendedPng('eXIf', tiffFixture([], [numberEntry(0xa001, 1, little)], little))), { format: 'png', width: 1, height: 1 });
	}
});

test('all seed truncations and deterministic mutation corpus stay bounded and inert', () => {
	const seeds = [PNG, JPEG, GIF, WEBP, bmp()];
	for (const seed of seeds) for (let length = 0; length < seed.length; length++) assert.throws(() => admitPhotoSourceV1(seed.slice(0, length)));
	let state = 0x73636170;
	for (let index = 0; index < 2_000; index++) {
		state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
		const bytes = seeds[index % seeds.length]!.slice(); bytes[state % bytes.length] ^= (state >>> 24) || 1;
		let admitted: Readonly<PhotoSourceAdmissionV1>;
		try { admitted = admitPhotoSourceV1(bytes); }
		catch (error) { assert.ok(error instanceof Error); continue; }
		assert.ok(admitted.width > 0 && admitted.width <= 8192 && admitted.height > 0 && admitted.height <= 8192);
		assert.ok(admitted.width * admitted.height <= 16_777_216 && Object.isFrozen(admitted));
	}
	let invoked = false; const bytes = PNG.slice(); Object.defineProperty(bytes, 'byteLength', { get() { invoked = true; throw new Error('getter'); } });
	assert.throws(() => admitPhotoSourceV1(bytes)); assert.equal(invoked, false);
});
