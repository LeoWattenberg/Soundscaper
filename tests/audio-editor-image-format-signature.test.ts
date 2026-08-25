/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	classifyImageFormatSignature,
	type ReviewedImageFormat,
} from '../src/common/editor/image-format-signature.ts';

const ASCII = new TextEncoder();

test('strong reviewed raster signatures classify without consulting names or MIME hints', () => {
	const fixtures: readonly (readonly [ReviewedImageFormat, Uint8Array])[] = [
		['jpeg', bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9)],
		['png', concat(bytes(0x89), ASCII.encode('PNG\r\n\x1a\n'), bytes(0, 0, 0, 0))],
		['gif', concat(ASCII.encode('GIF89a'), new Uint8Array(7))],
		['webp', riffWebp()],
		['bmp', bitmapFile()],
		['dib', dib()],
		['ico', ico()],
		['avif', ftyp('avif', 'mif1')],
		['heif', ftyp('mif1', 'heic')],
		['cr3', ftyp('crx ', 'crx ')],
		['tiff', concat(ASCII.encode('II'), bytes(42, 0, 8, 0, 0, 0))],
		['bigtiff', concat(ASCII.encode('MM'), bytes(0, 43, 0, 8, 0, 0, 0, 0, 0, 0, 0, 16))],
		['cr2', concat(ASCII.encode('II'), bytes(42, 0, 16, 0, 0, 0), ASCII.encode('CR'), bytes(2, 0))],
		['jpeg2000', concat(bytes(0, 0, 0, 12), ASCII.encode('jP  '), bytes(13, 10, 135, 10))],
		['jpeg2000', bytes(0xff, 0x4f, 0xff, 0x51, 0, 0, 0, 0)],
		['jpeg-xl', bytes(0xff, 0x0a, 0, 0)],
		['jpeg-xl', concat(bytes(0, 0, 0, 12), ASCII.encode('JXL '), bytes(13, 10, 135, 10))],
		['qoi', qoi()],
		['tga', tga()],
		['pcx', pcx()],
		['psd', photoshop(1)],
		['psb', photoshop(2)],
		['raf', concat(ASCII.encode('FUJIFILMCCD-RAW '), new Uint8Array(68))],
		['orf', concat(ASCII.encode('IIRO'), new Uint8Array(8))],
		['rw2', concat(ASCII.encode('IIU\0'), new Uint8Array(8))],
		['openexr', bytes(0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0)],
	];

	for (const [format, input] of fixtures) {
		assert.deepEqual(classifyImageFormatSignature(input), {
			status: 'recognized',
			format,
		}, format);
	}
});

test('generic TIFF stays TIFF until bounded metadata inspection can refine RAW variants', () => {
	for (const signature of [
		concat(ASCII.encode('II'), bytes(42, 0, 8, 0, 0, 0)),
		concat(ASCII.encode('MM'), bytes(0, 42, 0, 0, 0, 8)),
	]) {
		assert.deepEqual(classifyImageFormatSignature(signature), {
			status: 'recognized',
			format: 'tiff',
		});
	}
});

test('explicitly excluded families are terminal classifications', () => {
	const fixtures = [
		['svg', ASCII.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
		['pdf', ASCII.encode('%PDF-1.7\n')],
		['postscript', ASCII.encode('%!PS-Adobe-3.0\n')],
		['xcf', ASCII.encode('gimp xcf file\0')],
		['dicom', concat(new Uint8Array(128), ASCII.encode('DICM'))],
		['dds', ASCII.encode('DDS ')],
		['ktx', bytes(0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a)],
		['pnm', ASCII.encode('P6\n1 1\n255\n')],
		['pfm', ASCII.encode('PF\n1 1\n-1.0\n')],
		['radiance-hdr', ASCII.encode('#?RADIANCE\n')],
		['zip-container', bytes(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0)],
	] as const;

	for (const [format, input] of fixtures) {
		assert.deepEqual(classifyImageFormatSignature(input), {
			status: 'excluded',
			format,
		}, format);
	}
});

test('weak, truncated, contradictory, and unrelated prefixes remain unrecognized', () => {
	const spoofed = bitmapFile();
	spoofed[26] = 0;
	spoofed[27] = 0;
	const malformedWebp = riffWebp();
	malformedWebp[4] += 1;
	const malformedQoi = qoi();
	malformedQoi[12] = 2;
	const malformedPcx = pcx();
	malformedPcx[64] = 1;

	for (const input of [
		new Uint8Array(),
		ASCII.encode('BM'),
		ASCII.encode('RIFF\0\0\0\0WEBP'),
		spoofed,
		malformedWebp,
		malformedQoi,
		malformedPcx,
		ftyp('isom', 'mp42'),
		ASCII.encode('not an image'),
	]) {
		assert.deepEqual(classifyImageFormatSignature(input), { status: 'unrecognized' });
	}
});

test('the classifier accepts bytes only and does not execute object coercion', () => {
	let coerced = false;
	const hostile = {
		get byteLength() { coerced = true; return 100; },
	};
	assert.throws(
		() => classifyImageFormatSignature(hostile as never),
		/Image signature classification requires Uint8Array bytes/u,
	);
	assert.equal(coerced, false);
});

function bytes(...values: number[]): Uint8Array {
	return Uint8Array.from(values);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.byteLength;
	}
	return output;
}

function ftyp(major: string, ...compatible: readonly string[]): Uint8Array {
	const size = 16 + compatible.length * 4;
	const result = new Uint8Array(size);
	const view = new DataView(result.buffer);
	view.setUint32(0, size);
	result.set(ASCII.encode('ftyp'), 4);
	result.set(ASCII.encode(major), 8);
	for (const [index, brand] of compatible.entries()) {
		result.set(ASCII.encode(brand), 16 + index * 4);
	}
	return result;
}

function riffWebp(): Uint8Array {
	const result = new Uint8Array(20);
	result.set(ASCII.encode('RIFF'));
	new DataView(result.buffer).setUint32(4, 12, true);
	result.set(ASCII.encode('WEBP'), 8);
	result.set(ASCII.encode('VP8L'), 12);
	return result;
}

function dib(): Uint8Array {
	const result = new Uint8Array(44);
	const view = new DataView(result.buffer);
	view.setUint32(0, 40, true);
	view.setInt32(4, 1, true);
	view.setInt32(8, 1, true);
	view.setUint16(12, 1, true);
	view.setUint16(14, 32, true);
	return result;
}

function bitmapFile(): Uint8Array {
	const header = new Uint8Array(14);
	header.set(ASCII.encode('BM'));
	const body = dib();
	const result = concat(header, body);
	const view = new DataView(result.buffer);
	view.setUint32(2, result.byteLength, true);
	view.setUint32(10, 54, true);
	return result;
}

function ico(): Uint8Array {
	const result = new Uint8Array(23);
	const view = new DataView(result.buffer);
	view.setUint16(2, 1, true);
	view.setUint16(4, 1, true);
	result[6] = 1;
	result[7] = 1;
	view.setUint16(10, 1, true);
	view.setUint16(12, 32, true);
	view.setUint32(14, 1, true);
	view.setUint32(18, 22, true);
	return result;
}

function qoi(): Uint8Array {
	const result = new Uint8Array(22);
	result.set(ASCII.encode('qoif'));
	const view = new DataView(result.buffer);
	view.setUint32(4, 1);
	view.setUint32(8, 1);
	result[12] = 4;
	result[13] = 0;
	result[21] = 1;
	return result;
}

function tga(): Uint8Array {
	const result = new Uint8Array(44);
	const view = new DataView(result.buffer);
	result[2] = 2;
	view.setUint16(12, 1, true);
	view.setUint16(14, 1, true);
	result[16] = 32;
	result.set(ASCII.encode('TRUEVISION-XFILE.\0'), result.byteLength - 18);
	return result;
}

function pcx(): Uint8Array {
	const result = new Uint8Array(128);
	const view = new DataView(result.buffer);
	result[0] = 0x0a;
	result[1] = 5;
	result[2] = 1;
	result[3] = 8;
	view.setUint16(8, 1, true);
	view.setUint16(10, 1, true);
	result[65] = 3;
	view.setUint16(66, 2, true);
	return result;
}

function photoshop(version: 1 | 2): Uint8Array {
	const result = new Uint8Array(26);
	result.set(ASCII.encode('8BPS'));
	const view = new DataView(result.buffer);
	view.setUint16(4, version);
	view.setUint16(12, 4);
	view.setUint32(14, 1);
	view.setUint32(18, 1);
	view.setUint16(22, 8);
	view.setUint16(24, 3);
	return result;
}
