/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { paintPixelFrameCanvasV1 } from '../src/common/editor/imaging/pixel-frame-canvas-presenter-v1.ts';

const OWNER = new URL('../src/common/editor/imaging/pixel-frame-canvas-presenter-profile-current-v1.ts', import.meta.url);
async function owner() {
	assert.ok(existsSync(OWNER), 'Display P3 presentation requires a separately qualified native owner.');
	return import('../src/common/editor/imaging/pixel-frame-canvas-presenter-profile-current-v1.ts');
}
const frame = () => ({ descriptor: { schemaVersion: 1 as const, width: 1, height: 2, sampleFormat: 'unorm8' as const,
	primaries: 'display-p3' as const, transfer: 'srgb' as const }, pixels: Uint8Array.of(255, 0, 0, 128, 0, 255, 0, 0) });
interface Options {
	readonly attributes?: 'srgb' | 'missing' | 'opaque'; readonly imageColorMissing?: boolean; readonly modernAttributes?: boolean;
	readonly noConversion?: boolean; readonly wrongPrimary?: boolean; readonly wrongReadProfile?: boolean; readonly wrongReadExtent?: boolean;
	readonly copyImageData?: boolean; readonly drawError?: unknown; readonly cleanupError?: unknown;
}

/** Explicit native-boundary model, not browser color conformance. Root's real
 * Chromium/Firefox qualification checks the same owner against native APIs.
 * Fixed conversions below are independent observed primary literals. */
function nativeBoundary(options: Options = {}) {
	const previous = new Map<string, PropertyDescriptor | undefined>(), arrays: Uint8ClampedArray<ArrayBuffer>[] = [], canvases: FakeCanvas[] = [];
	const writes: { profile: string | undefined; values: number[]; probe: boolean }[] = [], events: string[] = [];
	class FakeImageData {
		readonly #data: Uint8ClampedArray<ArrayBuffer>; readonly #width: number; readonly #height: number; readonly #color: string | undefined;
		constructor(data: Uint8ClampedArray<ArrayBuffer>, width: number, height: number, settings: ImageDataSettings) {
			arrays.push(data); this.#data = options.copyImageData ? new Uint8ClampedArray(data) : data;
			if (this.#data !== data) arrays.push(this.#data);
			this.#width = width; this.#height = height; this.#color = options.imageColorMissing ? undefined : settings.colorSpace;
		}
		get data() { return this.#data; } get width() { return this.#width; } get height() { return this.#height; } get colorSpace() { return this.#color; }
	}
	class FakeContext {
		readonly #canvas: FakeCanvas; #pixels = new Uint8ClampedArray(0);
		constructor(canvas: FakeCanvas) { this.#canvas = canvas; }
		getContextAttributes() { return { alpha: options.attributes !== 'opaque',
			...(options.modernAttributes ? { colorType: 'unorm8', toneMapping: { mode: 'standard' } } : {}),
			...(options.attributes === 'missing' ? {} : { colorSpace: options.attributes === 'srgb' ? 'srgb' : 'display-p3' }) }; }
		putImageData(image: FakeImageData, x: number, y: number) {
			assert.deepEqual([x, y], [0, 0]); events.push('put');
			this.#canvas.drew = true;
			if (options.drawError !== undefined) throw options.drawError;
			this.#pixels.fill(0);
			writes.push({ profile: image.colorSpace, values: Array.from(image.data), probe: this.#canvas.probe });
			if (image.colorSpace === 'srgb' && !options.noConversion) {
				assert.deepEqual(Array.from(image.data), [255, 0, 0, 255, 0, 255, 0, 255]);
				this.#pixels = Uint8ClampedArray.of(234, 51, 35, 255, 117, 251, 76, 255);
			} else this.#pixels = new Uint8ClampedArray(image.data);
		}
		getImageData(x: number, y: number, width: number, height: number, settings: ImageDataSettings) {
			assert.deepEqual([x, y, width, height], [0, 0, 2, 1]); assert.equal(settings.colorSpace, 'display-p3'); events.push('read');
			const pixels = new Uint8ClampedArray(this.#pixels);
			if (options.wrongPrimary) pixels[0] = 250;
			return new FakeImageData(pixels, options.wrongReadExtent ? 1 : width, height,
				{ colorSpace: options.wrongReadProfile ? 'srgb' : 'display-p3' });
		}
		clear() { this.#pixels.fill(0); this.#pixels = new Uint8ClampedArray(0); }
		pixels() { return Array.from(this.#pixels); }
	}
	class FakeCanvas {
		#width = 0; #height = 0; readonly context: FakeContext; drew = false;
		constructor(readonly probe: boolean) { this.context = new FakeContext(this); canvases.push(this); }
		get width() { return this.#width; }
		set width(value: number) {
			events.push(`width:${value}`); if (value === 0 && this.drew && options.cleanupError !== undefined) throw options.cleanupError;
			this.#width = value; this.context.clear();
		}
		get height() { return this.#height; }
		set height(value: number) { events.push(`height:${value}`); this.#height = value; this.context.clear(); }
		getContext(kind: string, settings: CanvasRenderingContext2DSettings) {
			assert.equal(kind, '2d'); assert.equal(settings.colorSpace, 'display-p3'); assert.equal(settings.alpha, true); events.push('context'); return this.context;
		}
	}
	class FakeDocument {
		readonly #brand = true;
		createElement(name: string) { assert.equal(this.#brand, true); assert.equal(name, 'canvas'); return new FakeCanvas(true); }
	}
	for (const [name, value] of Object.entries({ HTMLCanvasElement: FakeCanvas, CanvasRenderingContext2D: FakeContext,
		ImageData: FakeImageData, Document: FakeDocument, document: new FakeDocument() })) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value });
	}
	return { arrays, canvases, writes, events, createCanvas: () => new FakeCanvas(false),
		restore() { for (const [name, value] of previous) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } },
		retired() { assert.ok(arrays.every(values => values.every(value => value === 0))); assert.ok(canvases.filter(canvas => canvas.probe).every(canvas => canvas.width === 0 && canvas.height === 0)); } };
}

test('permanent sRGB painter refuses a P3 descriptor before touching a native target', () => {
	let reflected = 0; const canvas = new Proxy({}, { get() { reflected++; throw new Error('target'); } });
	assert.throws(() => paintPixelFrameCanvasV1(canvas as HTMLCanvasElement, frame(), { limits: { maximumSidePixels: 2, maximumPixels: 2, maximumBytes: 8 } }));
	assert.equal(reflected, 0);
});

test('P3 qualification proves both native primary retention and actual sRGB-to-P3 conversion, then retires all probe storage', async () => {
	const api = await owner(), native = nativeBoundary();
	try {
		assert.equal(api.qualifyPixelFrameDisplayP3CurrentV1(), undefined);
		assert.deepEqual(native.writes.map(value => value.profile), ['display-p3', 'srgb']);
		assert.deepEqual(native.events.filter(value => value === 'read'), ['read', 'read']); native.retired();
	} finally { native.restore(); }
});

test('P3 qualification refuses missing declarations, false conversion, wrong primary retention and invalid readbacks', async () => {
	const api = await owner();
	for (const options of [{ attributes: 'srgb' }, { attributes: 'missing' }, { attributes: 'opaque' }, { imageColorMissing: true },
		{ noConversion: true }, { wrongPrimary: true }, { wrongReadProfile: true }, { wrongReadExtent: true }] as const) {
		const native = nativeBoundary(options);
		try { assert.throws(() => api.qualifyPixelFrameDisplayP3CurrentV1()); native.retired(); }
		finally { native.restore(); }
	}
});

test('qualified painter uses native target methods, aliases encoded P3 source storage and retains caller custody', async () => {
	const api = await owner(), native = nativeBoundary(), canvas = native.createCanvas(), source = frame(), before = source.pixels.slice();
	let overridden = 0;
	for (const name of ['width', 'height', 'getContext']) Object.defineProperty(canvas, name, { get() { overridden++; throw new Error('target shadow'); } });
	Object.defineProperty(canvas.context, 'putImageData', { get() { overridden++; throw new Error('context shadow'); } });
	try {
		assert.deepEqual(api.paintPixelFrameDisplayP3CurrentV1(source, canvas as unknown as HTMLCanvasElement), { width: 1, height: 2, byteLength: 8 });
		assert.deepEqual(native.writes.filter(value => !value.probe).map(value => value.values), [Array.from(before)]);
		assert.deepEqual(source.pixels, before); assert.equal(overridden, 0);
		assert.ok(native.arrays.some(values => values.buffer === source.pixels.buffer), 'Native ImageData must alias the borrowed source backing.');
		assert.ok(native.arrays.filter(values => values.buffer !== source.pixels.buffer).every(values => values.every(value => value === 0)));
	} finally { native.restore(); }
});

test('metadata and unavailable native capability refuse before reading source pixels or painting the requested target', async () => {
	const api = await owner(); let pixels = 0;
	for (const descriptor of [{ ...frame().descriptor, primaries: 'srgb' }, { ...frame().descriptor, transfer: 'linear' },
		{ ...frame().descriptor, sampleFormat: 'float32' }, { ...frame().descriptor, width: 8193 }]) {
		const native = nativeBoundary(), canvas = native.createCanvas();
		try {
			assert.throws(() => api.paintPixelFrameDisplayP3CurrentV1(Object.defineProperty({ descriptor }, 'pixels', { get() { pixels++; throw new Error('pixels'); } }), canvas as unknown as HTMLCanvasElement));
			assert.equal(native.writes.length, 0);
		} finally { native.restore(); }
	}
	const native = nativeBoundary({ attributes: 'srgb' }), canvas = native.createCanvas();
	try {
		assert.throws(() => api.paintPixelFrameDisplayP3CurrentV1(Object.defineProperty({ descriptor: frame().descriptor }, 'pixels', { get() { pixels++; throw new Error('pixels'); } }), canvas as unknown as HTMLCanvasElement));
		assert.equal(native.writes.filter(value => !value.probe).length, 0); native.retired();
	} finally { native.restore(); }
	assert.equal(pixels, 0);
});

test('copying ImageData cannot acquire caller pixels and all unexpectedly copied probe allocations retire', async () => {
	const api = await owner(), native = nativeBoundary({ copyImageData: true }), source = frame(), before = source.pixels.slice();
	try {
		assert.throws(() => api.paintPixelFrameDisplayP3CurrentV1(source, native.createCanvas() as unknown as HTMLCanvasElement), /alias|backing/iu);
		native.retired(); assert.deepEqual(source.pixels, before);
	} finally { native.restore(); }
});

test('opaque native failure and distinct zero-backing cleanup failure both survive while all arrays retire', async () => {
	const api = await owner(), primary = Proxy.revocable({}, {}); primary.revoke(); const cleanup = new Error('native canvas cleanup');
	const native = nativeBoundary({ drawError: primary.proxy });
	try {
		let observed: unknown; try { api.qualifyPixelFrameDisplayP3CurrentV1(); } catch (error) { observed = error; }
		assert.ok(Object.is(observed, primary.proxy)); native.retired();
	} finally { native.restore(); }
	const failing = nativeBoundary({ cleanupError: cleanup });
	try {
		let observed: unknown; try { api.qualifyPixelFrameDisplayP3CurrentV1(); } catch (error) { observed = error; }
		assert.equal(observed, cleanup); assert.ok(failing.arrays.every(values => values.every(value => value === 0)));
		assert.ok(failing.events.includes('height:0'), 'A failed width reset must still attempt native height retirement.');
	} finally { failing.restore(); }
	const combined = nativeBoundary({ drawError: primary.proxy, cleanupError: cleanup });
	try {
		let observed: unknown; try { api.qualifyPixelFrameDisplayP3CurrentV1(); } catch (error) { observed = error; }
		assert.ok(observed instanceof AggregateError); assert.ok(Object.is(observed.errors[0], primary.proxy));
		assert.ok(observed.errors.some((error: unknown) => Object.is(error, cleanup)));
		assert.ok(combined.arrays.every(values => values.every(value => value === 0)));
		assert.ok(combined.events.includes('height:0'));
	} finally { combined.restore(); }
});


test('P3 qualification admits actual Chromium context attributes including its standard tone-mapping declaration', async () => {
	// Shape observed by the real Chromium probe in this work packet. Extra
	// native rendering declarations do not contradict alpha/P3 qualification.
	const api = await owner(), native = nativeBoundary({ modernAttributes: true });
	try { assert.equal(api.qualifyPixelFrameDisplayP3CurrentV1(), undefined); native.retired(); }
	finally { native.restore(); }
});
