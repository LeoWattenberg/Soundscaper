/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PixelFrameDescriptorV1, PixelFrameLimitsV1, PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred } from './helpers/async-test-control.ts';

const nativeRead = Blob.prototype.arrayBuffer;
let readCalls = 0, heldRead: ((body: Blob) => Promise<ArrayBuffer>) | null = null;
Blob.prototype.arrayBuffer = function () {
	readCalls++;
	return heldRead ? heldRead(this) : Reflect.apply(nativeRead, this, []) as Promise<ArrayBuffer>;
};
test.after(() => { Blob.prototype.arrayBuffer = nativeRead; });

const { withPixelFrameBodyV1 } = await import('../src/common/editor/imaging/pixel-frame-body-v1.ts');
const { paintPixelFrameCanvasV1, clearPixelFrameCanvasV1 } = await import('../src/common/editor/imaging/pixel-frame-canvas-presenter-v1.ts');
const LIMITS = Object.freeze({ maximumSidePixels: 8, maximumPixels: 64, maximumBytes: 256 });
const descriptor = (width = 2, height = 3): PixelFrameDescriptorV1 & { sampleFormat: 'unorm8' } => ({ schemaVersion: 1, width, height,
	sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
const PIXELS = Uint8Array.of(10, 20, 30, 255, 40, 50, 60, 127, 70, 80, 90, 0, 100, 110, 120, 255,
	130, 140, 150, 127, 160, 170, 180, 255);
const request = (pixels = PIXELS, description = descriptor()) => ({ descriptor: description, byteLength: pixels.byteLength,
	outputSha256: createHash('sha256').update(pixels).digest('hex'), body: new Blob([Uint8Array.from(pixels)]) });

test('body independently authenticates one native read and wipes its borrowed pixels after awaited consumption', async () => {
	const input = request(); let frame: PixelFrameV1 | undefined, nativeBuffer: ArrayBuffer | undefined, nativeBody: Blob | undefined;
	heldRead = async body => { nativeBody = body; nativeBuffer = await Reflect.apply(nativeRead, body, []) as ArrayBuffer; return nativeBuffer; };
	const before = readCalls;
	try {
		const result = await withPixelFrameBodyV1(input, async current => {
			frame = current;
			assert.deepEqual([...current.pixels], [...PIXELS]);
			await Promise.resolve();
			assert.deepEqual([...current.pixels], [...PIXELS]);
			return { width: current.descriptor.width };
		}, { limits: LIMITS });
		assert.deepEqual(result, { width: 2 });
		assert.equal(readCalls - before, 1);
		assert.equal(nativeBody, input.body, 'native reading must not create an extra Blob handle');
		assert.ok(nativeBuffer && frame);
		assert.equal(frame.pixels.buffer, nativeBuffer);
		assert.deepEqual([...frame.pixels], Array.from({ length: 24 }, () => 0));
	} finally { heldRead = null; }
});

test('body ignores genuine Blob method overrides and hashes without WebCrypto', async () => {
	const input = request(); let getters = 0;
	for (const key of ['arrayBuffer', 'slice', 'size', 'stream', 'text', 'bytes']) Object.defineProperty(input.body, key, {
		get() { getters++; throw new Error('Blob override ran'); },
	});
	const prior = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
	Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { subtle: {
		digest() { throw new Error('WebCrypto would copy the payload'); },
	} } });
	try { await withPixelFrameBodyV1(input, frame => assert.deepEqual([...frame.pixels], [...PIXELS]), { limits: LIMITS }); }
	finally { if (prior) Object.defineProperty(globalThis, 'crypto', prior); else Reflect.deleteProperty(globalThis, 'crypto'); }
	assert.equal(getters, 0);
});

test('body refuses closed-record getters, future profiles, bad sizes and incomplete limits before reading', async () => {
	const input = request(), before = readCalls; let getterCalls = 0;
	const accessor = Object.defineProperty({ ...input }, 'body', { enumerable: true,
		get() { getterCalls++; throw new Error('request getter ran'); } });
	for (const candidate of [accessor, { ...input, surprise: true }, { ...input, outputSha256: 'bad' },
		{ ...input, byteLength: 23 }, { ...input, body: { size: 24, arrayBuffer: async () => new ArrayBuffer(24) } },
		{ ...input, descriptor: { ...input.descriptor, schemaVersion: 2 } },
		{ ...input, descriptor: { ...input.descriptor, sampleFormat: 'unorm16' } },
		{ ...input, descriptor: { ...input.descriptor, primaries: 'display-p3' } },
		{ ...input, descriptor: descriptor(9, 1) }]) {
		await assert.rejects(withPixelFrameBodyV1(candidate, () => { throw new Error('consumer must not run'); }, { limits: LIMITS }));
	}
	await assert.rejects(withPixelFrameBodyV1(input, () => undefined,
		{ limits: { maximumBytes: 24 } as unknown as PixelFrameLimitsV1 }), /required/u);
	assert.equal(readCalls, before); assert.equal(getterCalls, 0);
});

test('a held native read joins cancellation and wipes its late buffer without invoking the consumer', async () => {
	const pending = deferred<ArrayBuffer>(), cancel = new AbortController(), reason = new Error('presentation cancelled');
	const buffer = Uint8Array.from(PIXELS).buffer; let consumed = 0, settled = false;
	heldRead = () => pending.promise;
	try {
		const work = withPixelFrameBodyV1({ ...request(), signal: cancel.signal }, () => { consumed++; }, { limits: LIMITS });
		void work.then(() => { settled = true; }, () => { settled = true; });
		cancel.abort(reason); await Promise.resolve();
		assert.equal(settled, false, 'the owned read must drain before the operation settles');
		pending.resolve(buffer); await assert.rejects(work, error => error === reason);
		assert.equal(consumed, 0); assert.deepEqual([...new Uint8Array(buffer)], Array.from({ length: 24 }, () => 0));
	} finally { pending.resolve(buffer); heldRead = null; }
});

test('wrong hashes, wrong native read extents and consumer failure all wipe the acquired buffer', async () => {
	for (const mode of ['hash', 'extent', 'consumer']) {
		const buffer = Uint8Array.from(mode === 'extent' ? PIXELS.subarray(0, 20) : PIXELS).buffer;
		heldRead = async () => buffer;
		try {
			await assert.rejects(withPixelFrameBodyV1({ ...request(), ...(mode === 'hash' ? { outputSha256: '0'.repeat(64) } : {}) }, () => {
				assert.equal(mode, 'consumer'); throw new Error('consumer failed');
			}, { limits: LIMITS }), mode === 'consumer' ? /consumer failed/u : /digest|length|extent|sample count/iu);
			assert.ok(new Uint8Array(buffer).every(value => value === 0), mode);
		} finally { heldRead = null; }
	}
});

test('body checks native cancellation despite shadowed signal methods and retires cancellation during consumption', async () => {
	const cancel = new AbortController(), reason = new Error('consumer cancelled'); let getterCalls = 0;
	Object.defineProperty(cancel.signal, 'throwIfAborted', { get() { getterCalls++; throw new Error('signal getter ran'); } });
	let borrowed: Uint8Array | Uint8ClampedArray | undefined;
	await assert.rejects(withPixelFrameBodyV1({ ...request(), signal: cancel.signal }, frame => {
		assert.equal(frame.descriptor.sampleFormat, 'unorm8');
		borrowed = frame.pixels as Uint8Array;
		cancel.abort(reason);
	}, { limits: LIMITS }), error => error === reason);
	assert.equal(getterCalls, 0); assert.ok(borrowed?.every(value => value === 0));
});

test('incremental body authentication crosses borrowed hash spans and snapshots limits before the native await', async () => {
	const pixels = Uint8Array.from({ length: 128 * 129 * 4 }, (_, index) => index % 251);
	const input = request(pixels, descriptor(128, 129));
	const limits = { maximumSidePixels: 129, maximumPixels: 128 * 129, maximumBytes: pixels.byteLength };
	const pending = deferred<ArrayBuffer>(); heldRead = () => pending.promise;
	try {
		const work = withPixelFrameBodyV1(input, frame => assert.deepEqual([...frame.pixels], [...pixels]), { limits });
		limits.maximumBytes = 1; input.descriptor = descriptor();
		pending.resolve(Uint8Array.from(pixels).buffer);
		await work;
	} finally { pending.resolve(new ArrayBuffer(0)); heldRead = null; }
});

test('an already cancelled body does not read and borrowed view overrides cannot prevent cleanup', async () => {
	const cancel = new AbortController(), reason = new Error('already cancelled'), before = readCalls;
	cancel.abort(reason);
	await assert.rejects(withPixelFrameBodyV1({ ...request(), signal: cancel.signal }, () => undefined, { limits: LIMITS }), error => error === reason);
	assert.equal(readCalls, before);
	let buffer: ArrayBuffer | undefined, getters = 0;
	await withPixelFrameBodyV1(request(), frame => {
		buffer = frame.pixels.buffer;
		for (const key of ['fill', 'byteLength']) Object.defineProperty(frame.pixels, key, { get() { getters++; throw new Error('borrowed override ran'); } });
	}, { limits: LIMITS });
	assert.equal(getters, 0); assert.ok(buffer && new Uint8Array(buffer).every(value => value === 0));
});

test('a task-delivered cancellation interrupts incremental hashing before consumption and wipes its sole buffer', async () => {
	const pixels = new Uint8Array(512 * 513 * 4).fill(23), buffer = Uint8Array.from(pixels).buffer;
	const cancel = new AbortController(), reason = new Error('hash task cancelled'); let consumed = 0;
	const limits = { maximumSidePixels: 513, maximumPixels: 512 * 513, maximumBytes: pixels.byteLength };
	heldRead = async () => buffer;
	const timer = setTimeout(() => { cancel.abort(reason); }, 0);
	try {
		await assert.rejects(withPixelFrameBodyV1({ ...request(pixels, descriptor(512, 513)), signal: cancel.signal }, () => { consumed++; }, { limits }), error => error === reason);
		assert.equal(consumed, 0); assert.ok(new Uint8Array(buffer).every(value => value === 0));
	} finally { clearTimeout(timer); heldRead = null; }
});

test('canvas preserves oriented dimensions, straight alpha and native backing alias without retaining body pixels', async () => {
	const fixture = canvasFixture();
	try {
		const result = await withPixelFrameBodyV1(request(), frame => paintPixelFrameCanvasV1(fixture.canvas, frame, { limits: LIMITS }), { limits: LIMITS });
		assert.deepEqual(result, { width: 2, height: 3, byteLength: 24 });
		assert.equal(fixture.native.width, 2); assert.equal(fixture.native.height, 3);
		assert.deepEqual(fixture.painted(), [...PIXELS]);
		assert.deepEqual(fixture.events(), ['width:0', 'height:0', 'context', 'width:2', 'height:3', 'paint']);
		assert.equal(fixture.image()?.data.buffer, fixture.view()?.buffer);
		assert.ok(fixture.view()?.every(value => value === 0));
		clearPixelFrameCanvasV1(fixture.canvas);
		assert.equal(fixture.native.width, 0); assert.equal(fixture.native.height, 0);
	} finally { fixture.restore(); }
});

test('canvas rejects unsupported frame declarations and accessor options before touching its context or dimensions', () => {
	const fixture = canvasFixture(); let getters = 0;
	try {
		for (const description of [{ ...descriptor(), sampleFormat: 'unorm16' }, { ...descriptor(), primaries: 'display-p3' }, descriptor(9, 1)]) {
			assert.throws(() => paintPixelFrameCanvasV1(fixture.canvas, { descriptor: description, pixels: Uint8Array.from(PIXELS) } as PixelFrameV1, { limits: LIMITS }));
		}
		const options = Object.defineProperty({}, 'limits', { enumerable: true, get() { getters++; throw new Error('options getter ran'); } });
		assert.throws(() => paintPixelFrameCanvasV1(fixture.canvas, { descriptor: descriptor(), pixels: Uint8Array.from(PIXELS) }, options as { limits: typeof LIMITS }));
		assert.deepEqual(fixture.events(), []); assert.equal(getters, 0);
	} finally { fixture.restore(); }
});

test('canvas ignores overridden view methods and rejects an ImageData constructor that copies its backing', () => {
	const fixture = canvasFixture({ copyImageData: true }); let getters = 0;
	const pixels = Uint8Array.from(PIXELS);
	for (const key of ['constructor', 'slice', Symbol.iterator]) Object.defineProperty(pixels, key, {
		get() { getters++; throw new Error('view override ran'); },
	});
	try {
		assert.throws(() => paintPixelFrameCanvasV1(fixture.canvas, { descriptor: descriptor(), pixels }, { limits: LIMITS }), /alias|backing/iu);
		assert.equal(getters, 0); assert.equal(fixture.native.width, 0); assert.equal(fixture.native.height, 0);
		assert.ok(!fixture.events().includes('width:2')); assert.deepEqual(fixture.painted(), []);
	} finally { fixture.restore(); }
});

test('canvas refuses opaque or non-sRGB contexts and clears a failed or cancelled paint', () => {
	for (const options of [{ alpha: false }, { colorSpace: 'display-p3' }, { failPaint: true }, { cancelPaint: true }]) {
		const cancel = new AbortController(), fixture = canvasFixture({ ...options, cancel });
		try {
			assert.throws(() => paintPixelFrameCanvasV1(fixture.canvas, { descriptor: descriptor(), pixels: Uint8Array.from(PIXELS) }, { limits: LIMITS, signal: cancel.signal }));
			assert.equal(fixture.native.width, 0); assert.equal(fixture.native.height, 0);
		} finally { fixture.restore(); }
	}
});

test('omitted native attributes require a cleared transparent alpha probe and an ignored colorSpace member before legacy painting', () => {
	for (const options of [{ legacy: true, alpha: false, lazyOpaque: true }, { legacy: true }, { legacy: true, alpha: false }, { legacy: true, readsColorSpace: true }]) {
		const fixture = canvasFixture(options);
		try {
			const paint = () => paintPixelFrameCanvasV1(fixture.canvas, { descriptor: descriptor(), pixels: Uint8Array.from(PIXELS) }, { limits: LIMITS });
			if (options.alpha === false || options.readsColorSpace) {
				assert.throws(paint, /alpha|sRGB|color.*space|ambiguous/iu);
				assert.equal(fixture.native.width, 0); assert.equal(fixture.native.height, 0);
			} else {
				assert.deepEqual(paint(), { byteLength: 24, width: 2, height: 3 });
				assert.deepEqual(fixture.painted(), [...PIXELS]);
				assert.ok(fixture.events().includes('read-alpha'));
				assert.ok(fixture.events().indexOf('clear-alpha') >= 0);
				assert.ok(fixture.events().indexOf('clear-alpha') < fixture.events().indexOf('read-alpha'));
			}
			assert.ok(fixture.scratch().every(canvas => canvas.width === 0 && canvas.height === 0));
		} finally { fixture.restore(); }
	}
});

function canvasFixture(options: Readonly<{ copyImageData?: boolean; alpha?: boolean; colorSpace?: string; failPaint?: boolean; cancelPaint?: boolean; cancel?: AbortController; legacy?: boolean; readsColorSpace?: boolean; lazyOpaque?: boolean }> = {}) {
	const prior = new Map<string, PropertyDescriptor | undefined>();
	const events: string[] = []; let painted: number[] = [], image: { readonly data: Uint8ClampedArray } | undefined, view: Uint8ClampedArray | undefined;
	const scratch: FakeCanvas[] = [];
	class FakeImageData {
		readonly data: Uint8ClampedArray;
		constructor(data: Uint8ClampedArray, readonly width: number, readonly height: number, settings: ImageDataSettings) {
			assert.equal(settings.colorSpace, 'srgb'); view = data;
			this.data = options.copyImageData ? new Uint8ClampedArray(data) : data; image = { data: this.data };
		}
	}
	class FakeContext {
		#cleared = false;
		getContextAttributes() { return options.legacy ? { desynchronized: false, willReadFrequently: false } : { alpha: options.alpha ?? true, colorSpace: options.colorSpace ?? 'srgb' }; }
		clearRect(x: number, y: number, width: number, height: number) {
			assert.deepEqual([x, y, width, height], [0, 0, 1, 1]); events.push('clear-alpha'); this.#cleared = true;
		}
		getImageData(x: number, y: number, width: number, height: number) {
			assert.deepEqual([x, y, width, height], [0, 0, 1, 1]); events.push('read-alpha');
			return { data: Uint8ClampedArray.of(0, 0, 0, options.alpha === false && (!options.lazyOpaque || this.#cleared) ? 255 : 0) };
		}
		putImageData(data: FakeImageData, x: number, y: number) {
			assert.equal(x, 0); assert.equal(y, 0); events.push('paint');
			if (options.failPaint) throw new Error('paint failed');
			painted = [...data.data];
			if (options.cancelPaint) options.cancel?.abort(new Error('paint cancelled'));
		}
	}
	class FakeNode { get ownerDocument() { return document; } }
	class FakeCanvas extends FakeNode {
		#width = 7; #height = 7;
		get width() { return this.#width; } set width(value: number) { this.#width = value; events.push(`width:${String(value)}`); }
		get height() { return this.#height; } set height(value: number) { this.#height = value; events.push(`height:${String(value)}`); }
		getContext(kind: string, attributes: CanvasRenderingContext2DSettings) {
			assert.equal(kind, '2d'); assert.equal(attributes.alpha, true);
			if (!options.legacy || options.readsColorSpace) assert.equal(attributes.colorSpace, 'srgb');
			events.push('context');
			return new FakeContext();
		}
	}
	class FakeDocument {
		createElement(tag: string) { assert.equal(tag, 'canvas'); const canvas = new FakeCanvas(); scratch.push(canvas); return canvas; }
	}
	const document = new FakeDocument();
	for (const [key, value] of Object.entries({ HTMLCanvasElement: FakeCanvas, CanvasRenderingContext2D: FakeContext, ImageData: FakeImageData, Document: FakeDocument, Node: FakeNode })) {
		prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, value });
	}
	const native = new FakeCanvas();
	return { canvas: native as unknown as HTMLCanvasElement, native, events: () => events, painted: () => painted,
		image: () => image, view: () => view, scratch: () => scratch,
		restore() { for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } },
	};
}
