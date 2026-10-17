/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { encodePixelFramePng16V1 } from '../src/common/editor/imaging/pixel-frame-png16-v1.ts';

const OWNER = new URL('../src/common/editor/imaging/pixel-frame-png-profile-current-v1.ts', import.meta.url);
async function encoder() {
	assert.ok(existsSync(OWNER), 'Current P3 PNG requires its own explicit profile/depth entry point.');
	return (await import('../src/common/editor/imaging/pixel-frame-png-profile-current-v1.ts')).encodePixelFramePngProfileCurrentV1;
}
const descriptor = (width: number, height: number, sampleFormat: 'unorm8' | 'float32') => ({ schemaVersion: 1 as const, width, height,
	sampleFormat, primaries: 'srgb' as const, transfer: sampleFormat === 'unorm8' ? 'srgb' as const : 'linear' as const });
function bytes(values: readonly number[], width = values.length / 4, height = 1) {
	return { descriptor: { ...descriptor(width, height, 'unorm8'), sampleFormat: 'unorm8' as const }, pixels: Uint8Array.from(values) };
}
function floats(values: readonly number[], width = values.length / 4, height = 1) {
	return { descriptor: { ...descriptor(width, height, 'float32'), sampleFormat: 'float32' as const }, pixels: Float32Array.from(values) };
}
function parsed(data: Uint8Array) {
	assert.deepEqual(Array.from(data.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength), chunks: { type: string; bytes: Uint8Array }[] = [];
	for (let at = 8; at < data.length;) {
		assert.ok(at + 12 <= data.length); const size = view.getUint32(at), end = at + size + 12; assert.ok(end <= data.length);
		let crc = 0xffffffff;
		for (const value of data.subarray(at + 4, end - 4)) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
		assert.equal(view.getUint32(end - 4), (crc ^ 0xffffffff) >>> 0);
		chunks.push({ type: String.fromCharCode(...data.subarray(at + 4, at + 8)), bytes: data.slice(at + 8, end - 4) }); at = end;
	}
	assert.equal(chunks[0]!.type, 'IHDR'); assert.equal(chunks.at(-1)!.type, 'IEND');
	const header = chunks[0]!.bytes, geometry = new DataView(header.buffer), width = geometry.getUint32(0), height = geometry.getUint32(4), depth = header[8]!;
	assert.ok(depth === 8 || depth === 16); assert.deepEqual(Array.from(header.subarray(9)), [6, 0, 0, 0]);
	const compressed = Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.bytes));
	const stride = width * 4 * depth / 8 + 1, raw = inflateSync(compressed, { maxOutputLength: stride * height });
	assert.equal(raw.length, stride * height); const samples: number[] = [];
	for (let y = 0; y < height; y++) {
		assert.equal(raw[y * stride], 0);
		for (let at = y * stride + 1; at < (y + 1) * stride; at += depth / 8) samples.push(depth === 8 ? raw[at]! : raw.readUInt16BE(at));
	}
	return { width, height, depth, chunks, samples };
}
function p3(png: ReturnType<typeof parsed>): void {
	assert.deepEqual(png.chunks.map(chunk => chunk.type), ['IHDR', 'cICP', ...png.chunks.slice(2, -1).map(() => 'IDAT'), 'IEND']);
	assert.deepEqual(Array.from(png.chunks[1]!.bytes), [12, 13, 0, 1]);
}
// Independent D65 XYZ composition from CSS Color4; no production matrix,
// transfer, quantizer, checksum or compressor is part of this oracle.
const A = [[506752 / 1228815, 87881 / 245763, 12673 / 70218], [87098 / 409605, 175762 / 245763, 12673 / 175545], [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
const B = [[446124 / 178915, -333277 / 357830, -72051 / 178915], [-14852 / 17905, 63121 / 35810, 423 / 17905], [11844 / 330415, -50337 / 660830, 316169 / 330415]];
function expected(values: ArrayLike<number>, source: 'byte' | 'float', depth: 8 | 16): number[] {
	const out: number[] = [], maximum = depth === 8 ? 255 : 65535;
	for (let index = 0; index < values.length; index += 4) {
		const rgb = Array.from({ length: 3 }, (_, channel) => {
			const value = values[index + channel]! / (source === 'byte' ? 255 : 1);
			return source === 'float' ? value : value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
		});
		const xyz = A.map(row => row.reduce((sum, coefficient, channel) => sum + coefficient * rgb[channel]!, 0));
		for (const row of B) {
			const value = Math.max(0, Math.min(1, row.reduce((sum, coefficient, channel) => sum + coefficient * xyz[channel]!, 0)));
			out.push(Math.round(maximum * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055)));
		}
		out.push(Math.round(maximum * values[index + 3]! / (source === 'byte' ? 255 : 1)));
	}
	return out;
}
function observed<T>(value: Promise<T>) { return value.then(result => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error })); }

test('permanent PNG entry points retain exact sRGB defaults and refuse Current profile options', async () => {
	const source = bytes([64, 32, 16, 128]);
	assert.equal(parsed(await encodePixelFramePngV1(source)).chunks[1]!.type, 'sRGB');
	assert.equal(parsed(await encodePixelFramePng16V1(source)).chunks[1]!.type, 'sRGB');
	await assert.rejects(encodePixelFramePngV1(source, { profile: 'display-p3' }));
	await assert.rejects(encodePixelFramePng16V1(source, { profile: 'display-p3' }));
});

test('Current profiled PNG emits independent P3 primary literals and exact alpha with truthful cICP at both depths', async () => {
	const encode = await encoder(), source = bytes([255, 0, 0, 128, 0, 255, 0, 0, 0, 0, 255, 255]), before = source.pixels.slice();
	for (const bitDepth of [8, 16] as const) {
		const output = await encode(source, { profile: 'display-p3', bitDepth }), png = parsed(output); p3(png);
		assert.equal(png.depth, bitDepth); assert.deepEqual(png.samples, expected(before, 'byte', bitDepth));
		if (bitDepth === 8) assert.deepEqual(png.samples, [234, 51, 35, 128, 117, 251, 76, 0, 0, 0, 245, 255]);
		assert.deepEqual(source.pixels, before); assert.deepEqual(await encode(source, { profile: 'display-p3', bitDepth }), output);
	}
});

test('native linear HDR and sub-byte samples convert to P3 before the final output clipping and quantization', async () => {
	const encode = await encoder();
	const source = floats([1.2249401762805598, -.04205695470968816, -.019637554590334432, .5, -.25, 2, .0031308, 0,
		1 / 65535, 2 / 65535, 3 / 65535, 1]), before = source.pixels.slice();
	for (const bitDepth of [8, 16] as const) {
		const png = parsed(await encode(source, { profile: 'display-p3', bitDepth })); p3(png);
		assert.deepEqual(png.samples, expected(before, 'float', bitDepth));
		assert.deepEqual(png.samples.slice(0, 4), [bitDepth === 8 ? 255 : 65535, 0, 0, bitDepth === 8 ? 128 : 32768]);
		assert.deepEqual(source.pixels, before);
	}
	const equivalent = { ...source, descriptor: { ...source.descriptor, primaries: 'bt709' as const } };
	assert.deepEqual(await encode(equivalent, { profile: 'display-p3', bitDepth: 16 }), await encode(source, { profile: 'display-p3', bitDepth: 16 }));
});

test('explicit Current sRGB delegates exact permanent PNG8 and PNG16 bytes', async () => {
	const encode = await encoder(), source = bytes([9, 31, 57, 128, 73, 29, 240, 0]);
	assert.deepEqual(await encode(source, { profile: 'srgb', bitDepth: 8 }), await encodePixelFramePngV1(source));
	assert.deepEqual(await encode(source, { profile: 'srgb', bitDepth: 16 }), await encodePixelFramePng16V1(source));
	const native = floats([.003, .5, 4, .25]);
	assert.deepEqual(await encode(native, { profile: 'srgb', bitDepth: 16 }), await encodePixelFramePng16V1(native));
});

test('profile/depth and source-profile refusal precede source pixels, and preabort retains exact opaque identity', async () => {
	const encode = await encoder(); let reflected = 0;
	const source = Object.defineProperty({ descriptor: descriptor(1, 1, 'float32') }, 'pixels', { get() { reflected++; throw new Error('pixels'); } });
	for (const options of [{ bitDepth: 16 }, { profile: 'display-p3' }, { profile: 'bt2020', bitDepth: 16 }, { profile: 'display-p3', bitDepth: 10 }]) {
		await assert.rejects(encode(source, options));
	}
	for (const patch of [{ primaries: 'display-p3' }, { transfer: 'pq' }, { sampleFormat: 'unorm16', transfer: 'linear' }]) {
		await assert.rejects(encode(Object.defineProperty({ descriptor: { ...source.descriptor, ...patch } }, 'pixels', { get() { reflected++; throw new Error('pixels'); } }), { profile: 'display-p3', bitDepth: 16 }));
	}
	assert.equal(reflected, 0);
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const abort = new AbortController(); abort.abort(opaque.proxy);
	const outcome = await observed(encode(source, { profile: 'display-p3', bitDepth: 16, signal: abort.signal }));
	assert.equal(outcome.ok, false); if (!outcome.ok) assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(reflected, 0);
});

test('P3 streaming crosses row/sample boundaries, preserves padded source custody and returns an independent output', async () => {
	const encode = await encoder(), width = 257, height = 65, backing = new Uint8Array(width * height * 4 + 8); backing.fill(71);
	const pixels = backing.subarray(4, backing.length - 4);
	for (let index = 0; index < pixels.length; index++) pixels[index] = (index * 73 + Math.floor(index / 256)) & 255;
	const before = backing.slice(), source = { descriptor: descriptor(width, height, 'unorm8'), pixels };
	const output = await encode(source, { profile: 'display-p3', bitDepth: 16 }), png = parsed(output); p3(png);
	assert.deepEqual(png.samples, expected(pixels, 'byte', 16)); assert.deepEqual(backing, before);
	pixels.fill(0); assert.deepEqual(parsed(output).samples, png.samples); assert.equal(backing[0], 71); assert.equal(backing.at(-1), 71);
});

test('P3 native cancellation joins streamed work and rejects detached source storage without publication', async () => {
	const encode = await encoder(), source = bytes(new Array<number>(257 * 65 * 4).fill(128), 257, 65), before = source.pixels.slice();
	const abort = new AbortController(), reason = {}; const timer = setTimeout(() => { abort.abort(reason); }, 0);
	try {
		const outcome = await observed(encode(source, { profile: 'display-p3', bitDepth: 16, signal: abort.signal }));
		assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(outcome.error, reason);
	} finally { clearTimeout(timer); }
	assert.deepEqual(source.pixels, before);
	const detached = bytes(new Array<number>(257 * 65 * 4).fill(128), 257, 65);
	const detach = setTimeout(() => { structuredClone(detached.pixels.buffer, { transfer: [detached.pixels.buffer] }); }, 0);
	try { await assert.rejects(encode(detached, { profile: 'display-p3', bitDepth: 16 }), /detach|changed/iu); }
	finally { clearTimeout(detach); }
});
