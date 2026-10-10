/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { encodePixelFrameJpegV1 } from '../src/common/editor/imaging/pixel-frame-jpeg-v1.ts';

const RGBA = [9, 81, 173, 255, 231, 42, 19, 255, 56, 199, 103, 255, 145, 7, 224, 255];
const descriptor = { schemaVersion: 1, width: 2, height: 2, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' };
const frame = (pixels: Uint8Array | Uint8ClampedArray = Uint8Array.from(RGBA)) => ({ descriptor, pixels });
const options = { quality: 0.87, maximumOutputBytes: 4096 };

// Structural codec-output fixture, not a JPEG pixel/codec golden. These tests
// independently witness the exact asymmetric pixels handed to the native API.
function jpeg(width = 2, height = 2): Uint8Array<ArrayBuffer> {
	return Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255,
		3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0, 7, 0xff, 0xd9);
}
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
function nativeFixture(context: TestContext, mode: 'offscreen' | 'html' = 'offscreen') {
	let codec: () => Promise<Blob | null> = () => Promise.resolve(new Blob([jpeg()], { type: 'image/jpeg' }));
	const calls: { type: string | undefined; quality: number | undefined }[] = [];
	const imageData: Uint8ClampedArray<ArrayBuffer>[] = [], canvases: Canvas[] = [], copied: number[][] = [];
	class Data {
		constructor(readonly data: Uint8ClampedArray<ArrayBuffer>, readonly width: number, readonly height: number,
			settings: ImageDataSettings) { assert.deepEqual(settings, { colorSpace: 'srgb' }); imageData.push(data); }
	}
	class Canvas {
		width: number; height: number;
		constructor(width = 0, height = 0) { this.width = width; this.height = height; canvases.push(this); }
		getContext(kind: string, settings: unknown) {
			assert.equal(kind, '2d'); assert.deepEqual(settings, { alpha: false, colorSpace: 'srgb' });
			return { putImageData: (input: Data, x: number, y: number) => {
				assert.equal(x, 0); assert.equal(y, 0); assert.equal(input.width, this.width); assert.equal(input.height, this.height);
				copied.push(Array.from(input.data));
			} };
		}
		convertToBlob(input: ImageEncodeOptions) { calls.push({ type: input.type, quality: input.quality }); return codec(); }
		toBlob(callback: BlobCallback, type?: string, quality?: number) {
			calls.push({ type, quality }); void codec().then(callback);
		}
	}
	if (mode === 'html') Reflect.deleteProperty(Canvas.prototype, 'convertToBlob');
	for (const [key, value] of Object.entries({ OffscreenCanvas: mode === 'offscreen' ? Canvas : undefined,
		ImageData: Data, document: { createElement: (tag: string) => { assert.equal(tag, 'canvas'); return new Canvas(); } } })) {
		const original = Object.getOwnPropertyDescriptor(globalThis, key);
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
		context.after(() => { if (original) Object.defineProperty(globalThis, key, original); else Reflect.deleteProperty(globalThis, key); });
	}
	return { calls, imageData, canvases, copied, setCodec: (value: () => Promise<Blob | null>) => { codec = value; } };
}
function cleaned(fixture: ReturnType<typeof nativeFixture>) {
	for (const pixels of fixture.imageData) assert.equal(pixels.every(value => value === 0), true);
	for (const canvas of fixture.canvases) assert.deepEqual([canvas.width, canvas.height], [0, 0]);
}

test('native offscreen JPEG receives asymmetric opaque offset pixels and explicit sRGB/quality, returning independent bytes', async context => {
	const fixture = nativeFixture(context), padded = Uint8Array.from([31, 32, 33, ...RGBA, 34, 35]);
	const pixels = new Uint8Array(padded.buffer, 3, 16), before = padded.slice();
	const output = await encodePixelFrameJpegV1(frame(pixels), options);
	assert.deepEqual(fixture.copied, [RGBA]); assert.deepEqual(fixture.calls, [{ type: 'image/jpeg', quality: 0.87 }]);
	assert.deepEqual(output, jpeg()); assert.notEqual(output.buffer, pixels.buffer); assert.deepEqual(padded, before); cleaned(fixture);
});

test('HTML canvas callback adapter preserves the same clamped pixels and explicit quality endpoints', async context => {
	const fixture = nativeFixture(context, 'html'), pixels = Uint8ClampedArray.from(RGBA), before = pixels.slice();
	for (const quality of [0, 1]) assert.deepEqual(await encodePixelFrameJpegV1(frame(pixels), { ...options, quality }), jpeg());
	assert.deepEqual(fixture.copied, [RGBA, RGBA]); assert.deepEqual(fixture.calls.map(call => call.quality), [0, 1]);
	assert.deepEqual(pixels, before); cleaned(fixture);
});

test('profile, geometry, pixel shape and nonopaque alpha refuse without opening a native codec', async context => {
	const fixture = nativeFixture(context);
	for (const change of [{ sampleFormat: 'unorm16' }, { primaries: 'display-p3' }, { transfer: 'linear' }, { width: 0 }, { width: 65_536 }]) {
		await assert.rejects(encodePixelFrameJpegV1({ descriptor: { ...descriptor, ...change }, pixels: Uint8Array.from(RGBA) }, options), RangeError);
	}
	await assert.rejects(encodePixelFrameJpegV1(frame(new Uint8Array(15)), options), RangeError);
	const transparent = Uint8Array.from(RGBA); transparent[7] = 254; const before = transparent.slice();
	await assert.rejects(encodePixelFrameJpegV1(frame(transparent), options), /opaque/iu);
	assert.deepEqual(transparent, before); assert.equal(fixture.canvases.length, 0);
});

test('closed quality, native signal and explicit byte budgets refuse before consulting the frame', async context => {
	const fixture = nativeFixture(context); let reads = 0;
	const input = { get descriptor() { reads++; throw new Error('descriptor getter'); } };
	for (const invalid of [{}, { quality: -0.1 }, { quality: 1.1 }, { quality: NaN }, { quality: '0.9' },
		{ quality: 0.9, maximumOutputBytes: 0 }, { quality: 0.9, maximumOutputBytes: 268_435_457 },
		{ quality: 0.9, extra: true }, { get quality() { reads++; throw new Error('option getter'); } },
		{ quality: 0.9, signal: { aborted: false } }]) await assert.rejects(encodePixelFrameJpegV1(input, invalid));
	assert.equal(reads, 0); assert.equal(fixture.canvases.length, 0);
	const stop = new AbortController(), reason = Symbol('opaque preabort'); stop.abort(reason);
	await assert.rejects(encodePixelFrameJpegV1(input, { ...options, signal: stop.signal }), error => Object.is(error, reason));
});

test('native encoding cancellation joins held codec settlement before wiping workspace and preserves the opaque reason', async context => {
	const fixture = nativeFixture(context), hold = deferred<Blob | null>(), stop = new AbortController(), reason = Symbol('cancel');
	fixture.setCodec(() => hold.promise); let settled = false;
	const promise = encodePixelFrameJpegV1(frame(), { ...options, signal: stop.signal }).finally(() => { settled = true; });
	stop.abort(reason); await Promise.resolve(); await Promise.resolve();
	assert.equal(settled, false); assert.deepEqual(Array.from(fixture.imageData[0]!), RGBA);
	hold.resolve(new Blob([jpeg()], { type: 'image/jpeg' }));
	await assert.rejects(promise, error => Object.is(error, reason)); cleaned(fixture);
});

test('an aborted native rejection is still joined and preserves cancellation identity without inspecting either error', async context => {
	const fixture = nativeFixture(context), hold = deferred<Blob | null>(), stop = new AbortController();
	const reason = Symbol('cancel rejection'), codecFailure = new Proxy({}, { get() { throw new Error('opaque error inspected'); } });
	fixture.setCodec(() => hold.promise);
	const promise = encodePixelFrameJpegV1(frame(), { ...options, signal: stop.signal }); stop.abort(reason); hold.reject(codecFailure);
	await assert.rejects(promise, error => Object.is(error, reason)); cleaned(fixture);
});

test('null, wrong MIME, empty, oversized and dimension-mismatched native output refuse and clean workspace', async context => {
	const fixture = nativeFixture(context);
	for (const output of [null, new Blob([jpeg()], { type: 'image/png' }), new Blob([], { type: 'image/jpeg' }),
		new Blob([new Uint8Array(4097)], { type: 'image/jpeg' }), new Blob([jpeg(3, 2)], { type: 'image/jpeg' })]) {
		fixture.setCodec(() => Promise.resolve(output)); await assert.rejects(encodePixelFrameJpegV1(frame(), options)); cleaned(fixture);
	}
});

test('marker/header refusal wipes the independent materialized output rather than the borrowed source', async context => {
	const fixture = nativeFixture(context), corrupt = jpeg(); corrupt[0] = 0;
	fixture.setCodec(() => Promise.resolve(new Blob([corrupt], { type: 'image/jpeg' })));
	const outputs: Uint8Array[] = [], original = Uint8Array.prototype.fill;
	context.mock.method(Uint8Array.prototype, 'fill', function (this: Uint8Array, value: number) {
		outputs.push(this); return Reflect.apply(original, this, [value]) as Uint8Array;
	});
	const input = frame(), before = input.pixels.slice();
	await assert.rejects(encodePixelFrameJpegV1(input, options), /JPEG/iu);
	assert.equal(outputs.length, 1); assert.equal(outputs[0]!.every(value => value === 0), true);
	assert.deepEqual(input.pixels, before); cleaned(fixture);
});

test('native failure identity survives cleanup, and unavailable canvas refuses without mutating the source', async context => {
	const fixture = nativeFixture(context), reason = Symbol('native failure'); fixture.setCodec(() => Promise.reject(reason));
	await assert.rejects(encodePixelFrameJpegV1(frame(), options), error => Object.is(error, reason)); cleaned(fixture);
	Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: undefined });
	Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
	await assert.rejects(encodePixelFrameJpegV1(frame(), options), /canvas/iu);
});


test('copying a larger borrowed frame yields to cancellation before any native codec acquisition', async context => {
	const fixture = nativeFixture(context), pixels = new Uint8Array(512 * 256 * 4); pixels.fill(255);
	const before = pixels.slice(), stop = new AbortController(), reason = Symbol('copy cancellation');
	const promise = encodePixelFrameJpegV1({ descriptor: { ...descriptor, width: 512, height: 256 }, pixels }, { ...options, signal: stop.signal });
	stop.abort(reason); await assert.rejects(promise, error => Object.is(error, reason));
	assert.equal(fixture.canvases.length, 0); assert.deepEqual(pixels, before);
});

test('source detachment during a held native encode refuses output only after that codec settles', async context => {
	const fixture = nativeFixture(context), hold = deferred<Blob | null>(); fixture.setCodec(() => hold.promise);
	const input = frame(); let settled = false;
	const promise = encodePixelFrameJpegV1(input, options).finally(() => { settled = true; });
	structuredClone(input.pixels.buffer, { transfer: [input.pixels.buffer] }); await Promise.resolve();
	assert.equal(settled, false); hold.resolve(new Blob([jpeg()], { type: 'image/jpeg' }));
	await assert.rejects(promise, /detached/iu); cleaned(fixture);
});

test('malformed frame/scan boundaries and precision cannot masquerade as the requested JPEG', async context => {
	const fixture = nativeFixture(context);
	const precision = jpeg(); precision[6] = 12;
	const missingScan = jpeg().slice(0, 21); const truncated = jpeg(); truncated[4] = 255;
	const trailing = new Uint8Array(jpeg().length + 1); trailing.set(jpeg());
	for (const encoded of [precision, missingScan, truncated, trailing]) {
		fixture.setCodec(() => Promise.resolve(new Blob([encoded], { type: 'image/jpeg' })));
		await assert.rejects(encodePixelFrameJpegV1(frame(), options), /JPEG/iu); cleaned(fixture);
	}
});


test('materialization cancellation also joins the native byte copy before wiping its independent output', async context => {
	const fixture = nativeFixture(context), hold = deferred<ArrayBuffer>(), stop = new AbortController(), reason = Symbol('materialization');
	let entered = false, settled = false;
	context.mock.method(Blob.prototype, 'arrayBuffer', () => { entered = true; return hold.promise; });
	const promise = encodePixelFrameJpegV1(frame(), { ...options, signal: stop.signal }).finally(() => { settled = true; });
	await Promise.resolve(); assert.equal(entered, true); stop.abort(reason); await Promise.resolve(); assert.equal(settled, false);
	const output = jpeg(); hold.resolve(output.buffer);
	await assert.rejects(promise, error => Object.is(error, reason)); assert.equal(output.every(value => value === 0), true); cleaned(fixture);
});

test('nonintrinsic, shared, detached and accessor-backed source pixels are refused before acquiring a canvas', async context => {
	const fixture = nativeFixture(context); class Samples extends Uint8Array {}
	const detached = new Uint8Array(16); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	for (const pixels of [new Samples(16), new Uint8Array(new SharedArrayBuffer(16)), detached]) {
		await assert.rejects(encodePixelFrameJpegV1({ descriptor, pixels }, options));
	}
	let reads = 0;
	await assert.rejects(encodePixelFrameJpegV1({ descriptor, get pixels() { reads++; throw new Error('accessor'); } }, options), TypeError);
	assert.equal(reads, 0); assert.equal(fixture.canvases.length, 0);
});
