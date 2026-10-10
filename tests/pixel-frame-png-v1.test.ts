/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { Zlib } from 'fflate';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';

const RGBA = [255, 17, 31, 255, 9, 200, 37, 128, 73, 29, 240, 0, 0, 128, 255, 1];
function frame(pixels: Uint8Array | Uint8ClampedArray = Uint8Array.from(RGBA), width = 2, height = 2) {
	return { descriptor: { schemaVersion: 1 as const, width, height,
		sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels };
}

function noisyFrame() {
	const pixels = new Uint8Array(257 * 65 * 4); let seed = 12345;
	for (let n = 0; n < pixels.length; n++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; pixels[n] = seed >>> 24; }
	return frame(pixels, 257, 65);
}

// Independent PNG reader: Node's inflater and a bit-at-a-time CRC, rather than
// the encoder's compressor, chunk writer, checksum table or row preparation.
function png(bytes: Uint8Array) {
	assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	const chunks: { type: string; data: Uint8Array }[] = [];
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 8;
	while (offset < bytes.length) {
		assert.ok(offset + 12 <= bytes.length);
		const length = view.getUint32(offset), end = offset + 12 + length;
		assert.ok(end <= bytes.length);
		const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
		let crc = 0xffff_ffff;
		for (const byte of bytes.subarray(offset + 4, end - 4)) {
			crc ^= byte;
			for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
		}
		assert.equal(view.getUint32(end - 4), (crc ^ 0xffff_ffff) >>> 0, type);
		chunks.push({ type, data: bytes.subarray(offset + 8, end - 4) }); offset = end;
	}
	assert.equal(offset, bytes.length);
	assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'sRGB', ...chunks.slice(2, -1).map(() => 'IDAT'), 'IEND']);
	assert.ok(chunks.length >= 4); assert.equal(chunks.at(-1)!.data.length, 0);
	const compressed = Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data));
	return { ihdr: [...chunks[0]!.data], srgb: [...chunks[1]!.data], rows: [...inflateSync(compressed)] };
}

test('a 2×2 asymmetric straight-alpha PNG pins independent geometry, profile, CRC and literal scanlines', async () => {
	const source = frame(), before = [...source.pixels];
	const encoded = await encodePixelFramePngV1(source), parsed = png(encoded);
	assert.deepEqual(parsed.ihdr, [0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0, 0, 0]);
	assert.deepEqual(parsed.srgb, [0]);
	assert.deepEqual(parsed.rows, [0, 255, 17, 31, 255, 9, 200, 37, 128, 0, 73, 29, 240, 0, 0, 128, 255, 1]);
	assert.deepEqual([...source.pixels], before);
	assert.deepEqual(await encodePixelFramePngV1(source), encoded);
	source.pixels.fill(42);
	assert.deepEqual(png(encoded), parsed);
});

test('nonzero-offset clamped pixels retain padding, hidden RGB and alpha without canonicalization', async () => {
	const backing = new Uint8ClampedArray([71, 72, ...RGBA, 73, 74]);
	const source = frame(backing.subarray(2, 18));
	const encoded = await encodePixelFramePngV1(source);
	assert.deepEqual(png(encoded).rows, [0, 255, 17, 31, 255, 9, 200, 37, 128, 0, 73, 29, 240, 0, 0, 128, 255, 1]);
	assert.deepEqual([...backing], [71, 72, ...RGBA, 73, 74]);
	assert.deepEqual(encoded, await encodePixelFramePngV1(frame()));
});

test('a successful multi-chunk zlib stream retains every row across real task yields', async () => {
	const source = noisyFrame(), before = [...source.pixels];
	const expectedRows = Array.from({ length: 65 }, (_, row) => [0, ...source.pixels.subarray(row * 257 * 4, (row + 1) * 257 * 4)]).flat();
	const encoded = await encodePixelFramePngV1(source), parsed = png(encoded);
	assert.deepEqual(parsed.ihdr, [0, 0, 1, 1, 0, 0, 0, 65, 8, 6, 0, 0, 0]);
	assert.deepEqual(parsed.rows, expectedRows); assert.deepEqual(parsed.srgb, [0]);
	assert.deepEqual(await encodePixelFramePngV1(source), encoded); assert.deepEqual([...source.pixels], before);
});

test('unsupported depth or color and invalid geometry refuse before reading pixel accessors', async () => {
	let inspected = 0;
	for (const patch of [{ sampleFormat: 'unorm16' }, { sampleFormat: 'float32' }, { primaries: 'display-p3' },
		{ transfer: 'linear' }, { transfer: 'pq' }, { width: 65_537 }]) {
		const source = { descriptor: { ...frame().descriptor, ...patch }, get pixels() { inspected++; throw Error('Pixels inspected'); } };
		await assert.rejects(encodePixelFramePngV1(source), TypeError);
		await assert.rejects(encodePixelFramePngV1({ ...frame(), descriptor: source.descriptor }), RangeError);
	}
	assert.equal(inspected, 0);
	await assert.rejects(encodePixelFramePngV1({ ...frame(), pixels: new Uint8Array(15) }), /geometry/u);
	await assert.rejects(encodePixelFramePngV1(frame(), { limits: { maximumBytes: 15 } }), /byte length/u);
});

test('output storage limits and closed options refuse before acquiring borrowed pixels', async () => {
	let inspected = 0;
	const source = { descriptor: frame().descriptor, get pixels() { inspected++; throw Error('Pixels inspected'); } };
	for (const maximumOutputBytes of [0, 1, 1.5, Number.NaN, 268_435_457]) {
		await assert.rejects(encodePixelFramePngV1(source, { maximumOutputBytes }), RangeError);
	}
	await assert.rejects(encodePixelFramePngV1(source, { quality: 90 }), /unsupported/u);
	await assert.rejects(encodePixelFramePngV1(source, { get signal() { inspected++; throw Error('Signal inspected'); } }), /data/u);
	assert.equal(inspected, 0);
});

test('native preabort preserves an opaque reason without inspecting a frame or forged signal', async () => {
	let reflected = 0;
	const opaque = new Proxy({}, { get() { reflected++; throw Error('Opaque reason inspected'); }, getPrototypeOf() { reflected++; throw Error(); } });
	const source = new Proxy({}, { getOwnPropertyDescriptor() { reflected++; throw Error('Frame inspected'); } });
	const stop = new AbortController(); stop.abort(opaque);
	const result = await encodePixelFramePngV1(source, { signal: stop.signal })
		.then(() => ({ failed: false, reason: undefined as unknown }), (reason: unknown) => ({ failed: true, reason }));
	assert.equal(result.failed, true); assert.ok(Object.is(result.reason, opaque));
	await assert.rejects(encodePixelFramePngV1(source, { signal: Object.create(AbortSignal.prototype) }), TypeError);
	assert.equal(reflected, 0);
});

test('bounded encoding yields to native cancellation without publishing partial bytes or writing the source', async () => {
	const source = frame(new Uint8Array(512 * 128 * 4).fill(91), 512, 128), stop = new AbortController();
	const reason = Symbol('cancel PNG'); let delivered = false;
	const timer = setTimeout(() => { stop.abort(reason); }, 0);
	try {
		await assert.rejects(encodePixelFramePngV1(source, { signal: stop.signal }).then(value => { delivered = true; return value; }), error => error === reason);
	} finally { clearTimeout(timer); }
	assert.equal(delivered, false); assert.ok(source.pixels.every(value => value === 91));
});

test('a native transfer during a yielded encode refuses a detached borrowed frame', async () => {
	const source = frame(new Uint8Array(512 * 128 * 4).fill(73), 512, 128);
	const timer = setTimeout(() => { structuredClone(source.pixels.buffer, { transfer: [source.pixels.buffer] }); }, 0);
	try { await assert.rejects(encodePixelFramePngV1(source), /detached/u); }
	finally { clearTimeout(timer); }
	assert.equal(source.pixels.byteLength, 0);
});

test('cancellation during final PNG assembly refuses delivery and wipes emitted codec outputs', async context => {
	const stop = new AbortController(), reason = Symbol('cancel assembly'), original = Zlib.prototype.push;
	const outputs: ArrayBuffer[] = []; let timer: ReturnType<typeof setTimeout> | undefined, delivered = false;
	context.mock.method(Zlib.prototype, 'push', function(this: Zlib, chunk: Uint8Array, final?: boolean) {
		const accept = this.ondata;
		this.ondata = (bytes, done) => {
			outputs.push(bytes.buffer); accept(bytes, done);
			if (done) timer = setTimeout(() => { stop.abort(reason); }, 0);
		};
		try { Reflect.apply(original, this, [chunk, final]); } finally { this.ondata = accept; }
	});
	const source = noisyFrame(), before = [...source.pixels];
	try {
		await assert.rejects(encodePixelFramePngV1(source, { signal: stop.signal }).then(value => { delivered = true; return value; }), error => error === reason);
	} finally { clearTimeout(timer); }
	assert.equal(delivered, false); assert.ok(outputs.length > 1);
	for (const buffer of outputs) assert.ok(new Uint8Array(buffer).every(value => value === 0));
	assert.deepEqual([...source.pixels], before);
});

test('storage refusal wipes emitted codec buffers and never changes borrowed original pixels', async context => {
	const outputs: ArrayBuffer[] = [], original = Zlib.prototype.push;
	context.mock.method(Zlib.prototype, 'push', function(this: Zlib, chunk: Uint8Array, final?: boolean) {
		const accept = this.ondata;
		this.ondata = (bytes, done) => { outputs.push(bytes.buffer); accept(bytes, done); };
		try { Reflect.apply(original, this, [chunk, final]); } finally { this.ondata = accept; }
	});
	const pixels = new Uint8Array(512 * 32 * 4); let seed = 12345;
	for (let n = 0; n < pixels.length; n++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; pixels[n] = seed >>> 24; }
	const before = [...pixels];
	await assert.rejects(encodePixelFramePngV1(frame(pixels, 512, 32), { maximumOutputBytes: 1_048_576 + 80_000 }), /storage/u);
	assert.ok(outputs.length > 0); for (const buffer of outputs) assert.ok(new Uint8Array(buffer).every(value => value === 0));
	assert.deepEqual([...pixels], before);
});
