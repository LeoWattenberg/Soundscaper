/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { Zlib } from 'fflate';
import { encodePixelFramePng16V1 } from '../src/common/editor/imaging/pixel-frame-png16-v1.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';

function words(values: readonly number[], width = values.length / 4, height = 1) {
	return { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm16' as const,
		primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: Uint16Array.from(values) };
}
function floats(values: readonly number[], primaries: 'srgb' | 'bt709' = 'srgb', width = values.length / 4, height = 1) {
	return { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const,
		primaries, transfer: 'linear' as const }, pixels: Float32Array.from(values) };
}
function bytes(values: readonly number[], width = values.length / 4, height = 1) {
	return { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm8' as const,
		primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels: Uint8Array.from(values) };
}
function randomWords(width = 257, height = 65) {
	const value = words(new Array<number>(width * height * 4).fill(0), width, height); let seed = 125678;
	for (let index = 0; index < value.pixels.length; index++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; value.pixels[index] = seed >>> 16; }
	return value;
}

/** Independent PNG validation uses Node's inflater and a bit-at-a-time CRC,
 * rather than the encoder's fflate compressor, checksum table or row writer. */
function parse(bytes: Uint8Array) {
	assert.deepEqual(Array.from(bytes.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), chunks: { type: string; data: Uint8Array }[] = [];
	let cursor = 8;
	while (cursor < bytes.length) {
		assert.ok(cursor + 12 <= bytes.length); const length = view.getUint32(cursor), end = cursor + length + 12; assert.ok(end <= bytes.length);
		const type = String.fromCharCode(...bytes.subarray(cursor + 4, cursor + 8)); let crc = 0xffff_ffff;
		for (const byte of bytes.subarray(cursor + 4, end - 4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb8_8320 : 0); }
		assert.equal(view.getUint32(end - 4), (crc ^ 0xffff_ffff) >>> 0, type);
		chunks.push({ type, data: bytes.subarray(cursor + 8, end - 4) }); cursor = end;
	}
	assert.equal(cursor, bytes.length); assert.ok(chunks.length >= 4);
	assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'sRGB', ...chunks.slice(2, -1).map(() => 'IDAT'), 'IEND']);
	assert.equal(chunks.at(-1)!.data.length, 0); assert.deepEqual(Array.from(chunks[1]!.data), [0]);
	const header = chunks[0]!.data, geometry = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const width = geometry.getUint32(0), height = geometry.getUint32(4), depth = header[8]!;
	assert.deepEqual(Array.from(header.subarray(9)), [6, 0, 0, 0]);
	const raw = inflateSync(Buffer.concat(chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)));
	const stride = width * 4 * depth / 8 + 1; assert.equal(raw.length, stride * height);
	const samples: number[] = [];
	for (let row = 0; row < height; row++) { assert.equal(raw[row * stride], 0); for (let offset = row * stride + 1; offset < (row + 1) * stride; offset += depth / 8) samples.push(depth === 16 ? raw.readUInt16BE(offset) : raw[offset]!); }
	return { width, height, depth, samples, raw: Array.from(raw), idatCount: chunks.length - 3 };
}
function observed<Value>(work: Promise<Value>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function nativeBacking(value: ArrayBufferLike): ArrayBuffer { assert.ok(value instanceof ArrayBuffer); return value; }

test('PNG16 writes literal big-endian RGBA16 scanlines, IHDR16, sRGB, zlib and every independent CRC', async () => {
	const values = [0, 1024, 1025, 65535, 1, 257, 65534, 32768, 4095, 32767, 32768, 0, 65535, 0, 2, 1];
	const source = words(values, 2, 2), before = source.pixels.slice(), output = await encodePixelFramePng16V1(source), png = parse(output);
	assert.deepEqual([png.width, png.height, png.depth], [2, 2, 16]); assert.deepEqual(png.samples, values);
	assert.deepEqual(png.raw, [0, 0, 0, 4, 0, 4, 1, 255, 255, 0, 1, 1, 1, 255, 254, 128, 0,
		0, 15, 255, 127, 255, 128, 0, 0, 0, 255, 255, 0, 0, 0, 2, 0, 1]);
	assert.deepEqual(source.pixels, before); assert.deepEqual(await encodePixelFramePng16V1(source), output);
	source.pixels.fill(42); assert.deepEqual(parse(output), png);
});

test('native Float32 linear clips RGB only at PNG16 delivery and keeps straight alpha and hidden RGB', async () => {
	for (const primaries of ['srgb', 'bt709'] as const) {
		const source = floats([0, .003, .5, .5, -.25, 1, 4, 0, .25, 0, 1, 1], primaries), before = source.pixels.slice();
		const png = parse(await encodePixelFramePng16V1(source));
		assert.equal(png.depth, 16); assert.deepEqual(png.samples, [0, 2540, 48192, 32768, 0, 65535, 65535, 0, 35199, 0, 65535, 65535]);
		assert.deepEqual(source.pixels, before); assert.equal(source.pixels[6], 4); assert.equal(source.pixels[4], -.25);
	}
});

test('PNG16 preserves adjacent native codes and low linear toe precision beyond byte bins', async () => {
	const encoded = parse(await encodePixelFramePng16V1(words([1024, 1025, 1026, 65535])));
	assert.deepEqual(encoded.samples, [1024, 1025, 1026, 65535]);
	const source = floats([1 / 65535, 2 / 65535, 3 / 65535, 1]);
	assert.deepEqual(parse(await encodePixelFramePng16V1(source)).samples, [13, 26, 39, 65535]);
});

test('explicit encoded byte compatibility expands each code by257 while permanent PNGV1 stays depth8', async () => {
	const source = bytes([0, 17, 255, 128, 73, 29, 240, 0]);
	assert.deepEqual(parse(await encodePixelFramePng16V1(source)).samples, [0, 4369, 65535, 32896, 18761, 7453, 61680, 0]);
	assert.equal(parse(await encodePixelFramePng16V1(source)).depth, 16);
	const old = parse(await encodePixelFramePngV1(source)); assert.equal(old.depth, 8); assert.deepEqual(old.samples, Array.from(source.pixels));
});

test('fixed native subviews preserve backing padding and emit encoded words without a host-endian leak', async () => {
	const backing = Uint16Array.of(71, 72, 1024, 1025, 65534, 1, 73, 74), source = { ...words([0, 0, 0, 0]), pixels: backing.subarray(2, 6) };
	assert.deepEqual(parse(await encodePixelFramePng16V1(source)).samples, [1024, 1025, 65534, 1]);
	assert.deepEqual(Array.from(backing), [71, 72, 1024, 1025, 65534, 1, 73, 74]);
});

test('streaming PNG16 crosses split sample bytes, row filters and multiple IDAT chunks exactly', async () => {
	const source = randomWords(8193, 2), before = source.pixels.slice(), output = await encodePixelFramePng16V1(source), png = parse(output);
	assert.deepEqual([png.width, png.height, png.depth], [8193, 2, 16]); assert.ok(png.idatCount > 1);
	assert.deepEqual(png.samples, Array.from(before)); assert.deepEqual(source.pixels, before);
	assert.deepEqual(await encodePixelFramePng16V1(source), output);
});

test('unsupported profiles, source limits and output bounds refuse before reflecting pixel data', async () => {
	let reads = 0;
	for (const patch of [{ transfer: 'pq' }, { transfer: 'srgb', sampleFormat: 'float32' }, { primaries: 'display-p3' },
		{ sampleFormat: 'unorm16', transfer: 'linear' }, { width: 65_537 }]) {
		const source = Object.defineProperty({ descriptor: { ...floats([0, 0, 0, 1]).descriptor, ...patch } }, 'pixels', { enumerable: true, get() { reads++; throw new Error('pixels'); } });
		await assert.rejects(encodePixelFramePng16V1(source));
	}
	const source = Object.defineProperty({ descriptor: words([0, 0, 0, 1]).descriptor }, 'pixels', { enumerable: true, get() { reads++; throw new Error('pixels'); } });
	for (const maximumOutputBytes of [0, 1, 1.5, NaN, 268_435_457]) await assert.rejects(encodePixelFramePng16V1(source, { maximumOutputBytes }), RangeError);
	await assert.rejects(encodePixelFramePng16V1(source, { limits: { maximumBytes: 7 } }));
	await assert.rejects(encodePixelFramePng16V1(source, { quality: 1 })); assert.equal(reads, 0);
});

test('native float samples and physical view geometry are admitted without overrides or shared/resizable storage', async () => {
	for (const values of [[NaN, 0, 0, 1], [Infinity, 0, 0, 1], [0, 0, 0, -.1], [0, 0, 0, 1.1]]) await assert.rejects(encodePixelFramePng16V1(floats(values)));
	for (const name of ['buffer', 'byteLength', 'byteOffset', 'length']) {
		const source = words([1, 2, 3, 4]); Object.defineProperty(source.pixels, name, { configurable: true, get() { throw new Error('shadow consulted'); } });
		await assert.rejects(encodePixelFramePng16V1(source), /shadow|geometry/iu);
	}
	await assert.rejects(encodePixelFramePng16V1({ ...words([1, 2, 3, 4]), pixels: new Uint16Array(new SharedArrayBuffer(8)) }));
	await assert.rejects(encodePixelFramePng16V1({ ...words([1, 2, 3, 4]), pixels: new Uint16Array(Reflect.construct(ArrayBuffer, [8, { maxByteLength: 16 }]) as ArrayBuffer) }));
	await assert.rejects(encodePixelFramePng16V1({ ...words([1, 2, 3, 4]), pixels: new Uint16Array(3) }));
});

test('preabort preserves a revoked opaque reason before frame reflection, while forged native signals refuse', async () => {
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const abort = new AbortController(); abort.abort(opaque.proxy); let reflected = 0;
	const source = new Proxy({}, { getOwnPropertyDescriptor() { reflected++; throw new Error('frame'); }, getPrototypeOf() { reflected++; throw new Error('frame'); } });
	const result = await observed(encodePixelFramePng16V1(source, { signal: abort.signal })); assert.equal(result.ok, false);
	if (result.ok) assert.fail('Pre-aborted PNG16 completed.'); assert.equal(Object.is(result.error, opaque.proxy), true); assert.equal(reflected, 0);
	await assert.rejects(encodePixelFramePng16V1(words([1, 2, 3, 4]), { signal: Object.create(AbortSignal.prototype) }), TypeError);
	await assert.rejects(encodePixelFramePng16V1(words([1, 2, 3, 4]), { get signal() { throw new Error('getter'); } }), /data/iu);
});

test('native cancellation joins a real row task and preserves source words without publishing partial PNG16', async () => {
	const source = randomWords(), before = source.pixels.slice(), abort = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const timer = setTimeout(() => { abort.abort(opaque.proxy); }, 0);
	try { const result = await observed(encodePixelFramePng16V1(source, { signal: abort.signal })); assert.equal(result.ok, false);
		if (result.ok) assert.fail('Cancelled PNG16 published.'); assert.equal(Object.is(result.error, opaque.proxy), true);
	} finally { clearTimeout(timer); }
	assert.deepEqual(source.pixels, before);
});

test('detachment during a streamed row refuses and mutable descriptor shadows cannot redirect a captured source', async () => {
	const source = randomWords(), timer = setTimeout(() => { structuredClone(source.pixels.buffer, { transfer: [source.pixels.buffer] }); }, 0);
	try { await assert.rejects(encodePixelFramePng16V1(source), /detach/iu); } finally { clearTimeout(timer); }
	const captured = randomWords(), expected = captured.pixels.slice();
	const shadow = setTimeout(() => { Object.defineProperty(captured.pixels, 'buffer', { configurable: true, value: new ArrayBuffer(0) }); captured.descriptor.width = 1; }, 0);
	try { const png = parse(await encodePixelFramePng16V1(captured)); assert.deepEqual([png.width, png.height], [257, 65]); assert.deepEqual(png.samples, Array.from(expected)); }
	finally { clearTimeout(shadow); }
});

test('output residency budget includes retained compressed chunks plus final PNG and wipes real emitted spans', async context => {
	const outputs: ArrayBuffer[] = [], push = Zlib.prototype.push;
	context.mock.method(Zlib.prototype, 'push', function(this: Zlib, bytes: Uint8Array, final?: boolean) {
		const accept = this.ondata; this.ondata = (chunk, done) => { outputs.push(nativeBacking(chunk.buffer)); accept(chunk, done); };
		try { Reflect.apply(push, this, [bytes, final]); } finally { this.ondata = accept; }
	});
	const source = randomWords(), before = source.pixels.slice();
	await assert.rejects(encodePixelFramePng16V1(source, { maximumOutputBytes: 1_048_576 + 80_000 }), /storage|budget/iu);
	assert.ok(outputs.length > 0); for (const backing of outputs) assert.ok(new Uint8Array(backing).every(byte => byte === 0)); assert.deepEqual(source.pixels, before);
});

test('successful streaming retires the actual codec rolling/hash backings and every bounded input/emitted span', async context => {
	const inputs: ArrayBuffer[] = [], outputs: ArrayBuffer[] = [], retained = new Set<ArrayBuffer>(), push = Zlib.prototype.push;
	context.mock.method(Zlib.prototype, 'push', function(this: Zlib, bytes: Uint8Array, final?: boolean) {
		inputs.push(nativeBacking(bytes.buffer)); assert.ok(bytes.byteLength <= 65_536); capture(this);
		const accept = this.ondata; this.ondata = (chunk, done) => { outputs.push(nativeBacking(chunk.buffer)); capture(this); accept(chunk, done); };
		try { Reflect.apply(push, this, [bytes, final]); } finally { capture(this); this.ondata = accept; }
	});
	const source = randomWords(), png = parse(await encodePixelFramePng16V1(source)); assert.deepEqual(png.samples, Array.from(source.pixels));
	assert.ok(inputs.length > 1); assert.ok(outputs.length > 1); assert.ok(retained.size >= 3);
	for (const backing of [...inputs, ...outputs, ...retained]) assert.ok(new Uint8Array(backing).every(byte => byte === 0));
	function capture(codec: Zlib) {
		const descriptors = Object.getOwnPropertyDescriptors(codec), body: unknown = descriptors.b?.value, state: unknown = descriptors.s?.value;
		if (body instanceof Uint8Array && body.byteLength) retained.add(nativeBacking(body.buffer));
		if (state && typeof state === 'object') for (const key of ['p', 'h']) {
			const values: unknown = Object.getOwnPropertyDescriptor(state, key)?.value;
			if (values instanceof Uint16Array && values.byteLength) retained.add(nativeBacking(values.buffer));
		}
	}
});

test('an actual codec boundary transfer preserves opaque primary plus physical row-retirement failure and still wipes its other owners', async context => {
	const source = randomWords(), before = source.pixels.slice(), push = Zlib.prototype.push, opaque = Proxy.revocable({}, {}); opaque.revoke();
	const outputs: ArrayBuffer[] = [], rolling: ArrayBuffer[] = []; let transferred = false;
	context.mock.method(Zlib.prototype, 'push', function(this: Zlib, bytes: Uint8Array, final?: boolean) {
		const body: unknown = Object.getOwnPropertyDescriptor(this, 'b')?.value; if (body instanceof Uint8Array) rolling.push(nativeBacking(body.buffer));
		const accept = this.ondata; this.ondata = (chunk, done) => { outputs.push(nativeBacking(chunk.buffer)); accept(chunk, done); };
		try {
			Reflect.apply(push, this, [bytes, final]);
			if (!transferred) { transferred = true; structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); throw opaque.proxy; }
		} finally { this.ondata = accept; }
	});
	const outcome = await observed(encodePixelFramePng16V1(source)); assert.equal(outcome.ok, false);
	if (outcome.ok) assert.fail('Transferred owned row escaped retirement.'); assert.ok(outcome.error instanceof AggregateError);
	const failures: unknown[] = outcome.error.errors; assert.equal(Object.is(failures[0], opaque.proxy), true);
	assert.ok(failures.slice(1).some(error => error instanceof TypeError && /detach/iu.test(error.message)));
	assert.equal(transferred, true); assert.ok(rolling.length > 0);
	for (const backing of [...outputs, ...rolling]) assert.ok(new Uint8Array(backing).every(byte => byte === 0)); assert.deepEqual(source.pixels, before);
});

test('cancellation during final container assembly rejects exact reason after real codec output retirement', async context => {
	const push = Zlib.prototype.push, abort = new AbortController(), reason = Symbol('PNG16 assembly'), outputs: ArrayBuffer[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	context.mock.method(Zlib.prototype, 'push', function(this: Zlib, bytes: Uint8Array, final?: boolean) {
		const accept = this.ondata; this.ondata = (chunk, done) => { outputs.push(nativeBacking(chunk.buffer)); accept(chunk, done); if (done) timer = setTimeout(() => { abort.abort(reason); }, 0); };
		try { Reflect.apply(push, this, [bytes, final]); } finally { this.ondata = accept; }
	});
	const source = randomWords(), before = source.pixels.slice();
	try { const result = await observed(encodePixelFramePng16V1(source, { signal: abort.signal })); assert.equal(result.ok, false);
		if (result.ok) assert.fail('Cancelled PNG16 container escaped.'); assert.equal(Object.is(result.error, reason), true);
	} finally { clearTimeout(timer); }
	assert.ok(outputs.length > 1); for (const backing of outputs) assert.ok(new Uint8Array(backing).every(byte => byte === 0)); assert.deepEqual(source.pixels, before);
});
