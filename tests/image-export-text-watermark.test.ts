/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import test, { type TestContext } from 'node:test';
import { captureImageExportTextV1 } from '../src/common/editor/image-export-text-v1.ts';
import { withImageExportTextFrameV1, type ImageExportTextCanvasV1 } from '../src/common/editor/imaging/image-export-text-frame-v1.ts';
import { IMAGE_EXPORT_TEXT_FONT_V1, type ImageExportTextFontPortV1 } from '../src/common/editor/imaging/image-export-text-font-v1.ts';
import { imageExportGraphicPlacement } from '../src/common/editor/image-export-graphic-request.ts';
import { withGraphicWatermarkPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-graphic-watermark-v1.ts';
import { imagingChunkGroups } from '../scripts/lib/build-chunk-imaging.mjs';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const FONT = new Uint8Array(await readFile(new URL('../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2', import.meta.url)));
const TEXT = { schemaVersion: 1, text: 'Grüße © 2026', font: 'inter-600-latin', color: '#ffffff',
	anchor: 'bottom-right', widthFraction: .5, marginFraction: .1, opacity: 1 } as const;
const request = (text: unknown = TEXT, signal?: AbortSignal) => ({ text, width: 20, height: 10, ...(signal === undefined ? {} : { signal }) });

function harness() {
	const calls: string[] = [], transports: Uint8Array<ArrayBuffer>[] = [], masks: Uint8ClampedArray<ArrayBuffer>[] = [];
	let family = '';
	const font: ImageExportTextFontPortV1 = {
		async fetch(_url, _signal) { assert.equal(this, font); calls.push('fetch'); return new Response(FONT.slice()); },
		async open(name, bytes) { assert.equal(this, font); family = name; transports.push(bytes); calls.push('font-open');
			return { family: name, close() { calls.push('font-close'); } }; },
	};
	const canvas: ImageExportTextCanvasV1 = {
		measure(text, face) { assert.equal(this, canvas); assert.equal(text, TEXT.text); assert.equal(face, family); calls.push('measure');
			return { left: 0, right: 8, ascent: 2, descent: 0 }; },
		draw(text, face, color, geometry) { assert.equal(this, canvas); assert.equal(text, TEXT.text); assert.equal(face, family); assert.equal(color, '#ffffff'); calls.push('draw');
			assert.deepEqual(geometry, { width: 9, height: 3, scale: 1.125, x: 0, y: 2.25 });
			const pixels = new Uint8ClampedArray(geometry.width * geometry.height * 4);
			for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([255, 255, 255, offset === 0 ? 0 : offset === 4 ? 128 : 255], offset);
			masks.push(pixels); return pixels; },
		close() { calls.push('canvas-close'); },
	};
	return { calls, transports, masks, font, canvas, options: { font, createCanvas: () => canvas } };
}

test('closed scalar admission captures supported NFC text and refuses unsafe, foreign, unsupported glyphs without accessors', () => {
	const input = { ...TEXT, opacity: 1 as number }; const captured = captureImageExportTextV1(input); input.opacity = .2;
	assert.equal(captured.opacity, 1); assert.ok(Object.isFrozen(captured));
	let getters = 0;
	for (const text of [' ', 'e\u0301', 'a\nb', '\ud800', 'a\u202eb', '漢', '\u00ad', '\t', 'a'.repeat(257)]) assert.throws(() => captureImageExportTextV1({ ...TEXT, text }));
	for (const patch of [{ schemaVersion: 2 }, { font: 'Inter' }, { color: '#fff' }, { widthFraction: 0 }, { marginFraction: .5 }, { opacity: NaN }, { future: true }]) assert.throws(() => captureImageExportTextV1({ ...TEXT, ...patch }));
	assert.throws(() => captureImageExportTextV1(Object.defineProperty({ ...TEXT }, 'text', { enumerable: true, get() { getters++; return TEXT.text; } })));
	assert.equal(getters, 0);
});

test('the exact font pin and every admitted Latin glyph are grounded in the installed paired font cmap', async () => {
	assert.equal(FONT.length, 24_452); assert.equal(createHash('sha256').update(FONT).digest('hex'), IMAGE_EXPORT_TEXT_FONT_V1.sha256);
	assert.equal(IMAGE_EXPORT_TEXT_FONT_V1.sha256, 'f9a06e79cd3a2a20951c0f0e28f66dd0e6d3fda73911d640a2125c8fcb78f21a');
	const woff = await readFile(new URL('../node_modules/@fontsource/inter/files/inter-latin-600-normal.woff', import.meta.url));
	assert.equal(createHash('sha256').update(woff).digest('hex'), '6a9cb3a509b4eeaf12b7dda6c4aacac3e85d07f4201bf4dd716e332e692b87bd');
	const supported = [...range(0x20, 0x7e), ...range(0xa0, 0xac), ...range(0xae, 0xff), 0x20ac, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x2122];
	for (const code of supported) { assert.notEqual(glyph(woff, code), 0, `Pinned font lacks U+${code.toString(16)}`);
		assert.equal(captureImageExportTextV1({ ...TEXT, text: `A${String.fromCodePoint(code)}` }).text, `A${String.fromCodePoint(code)}`); }
});

test('absence and zero opacity preserve an exact no-I/O bypass, while invalid text refuses before capabilities', async () => {
	for (const text of [undefined, { ...TEXT, opacity: 0 }]) assert.equal(await withImageExportTextFrameV1({ text, width: 20, height: 10 }, frame => { assert.equal(frame, null); return 'off'; }), 'off');
	const h = harness(); await assert.rejects(withImageExportTextFrameV1(request({ ...TEXT, text: '漢' }), () => undefined, h.options)); assert.deepEqual(h.calls, []);
});

test('real glyph coverage becomes independent straight-alpha sRGB pixels, with native owners closed before the held consumer', async () => {
	const h = harness(), entered = deferred<void>(), release = deferred<void>(); let borrowed: Uint8Array<ArrayBuffer> | undefined;
	const work = withImageExportTextFrameV1(request(), async frame => {
		assert.ok(frame); borrowed = frame.pixels as Uint8Array<ArrayBuffer>;
		assert.deepEqual(frame.descriptor, { schemaVersion: 1, width: 9, height: 3, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
		assert.deepEqual([...borrowed.subarray(0, 12)], [0,0,0,0,255,255,255,128,255,255,255,255]);
		assert.notEqual(borrowed.buffer, h.masks[0]!.buffer); assert.deepEqual(h.calls, ['fetch','font-open','measure','draw','canvas-close','font-close']);
		assert.ok(h.transports[0]!.every(byte => byte === 0)); assert.ok(h.masks[0]!.every(byte => byte === 0)); entered.resolve(); await release.promise; return 7;
	}, h.options);
	await entered.promise; assert.equal(await remainsPending(work), true); assert.equal(borrowed![7], 128); release.resolve(); assert.equal(await work, 7); assert.ok(borrowed!.every(byte => byte === 0));
});

test('cancellation joins held font loading, closes only its private face and never publishes a glyph plane', async () => {
	const h = harness(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('font cancellation'); let consumed = false;
	const open = h.font.open; h.font.open = async (...args) => { entered.resolve(); await release.promise; return Reflect.apply(open, h.font, args); };
	const work = withImageExportTextFrameV1(request(TEXT, stop.signal), () => { consumed = true; }, h.options);
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve(); await assert.rejects(work, error => error === reason);
	assert.equal(consumed, false); assert.deepEqual(h.calls, ['fetch','font-open','font-close']); assert.ok(h.transports[0]!.every(byte => byte === 0));
});

test('held consumer cancellation joins settlement and detached owned storage never replaces opaque primary refusal', async () => {
	const h = harness(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('consumer cancellation');
	const work = withImageExportTextFrameV1(request(TEXT, stop.signal), async frame => { assert.ok(frame); entered.resolve(); await release.promise; structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] }); throw reason; }, h.options);
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve(); await assert.rejects(work, error => error === reason);
});

test('font pin, stream length, canvas dimensions and shared working capacity refuse before glyph allocation', async () => {
	for (const body of [FONT.slice(0, -1), new Uint8Array(FONT.length), new Uint8Array(FONT.length + 1)]) {
		const h = harness(); h.font.fetch = async () => new Response(body); await assert.rejects(withImageExportTextFrameV1(request(), () => undefined, h.options), /font|byte|digest/iu); assert.deepEqual(h.calls, []);
	}
	const h = harness(); h.canvas.measure = () => ({ left: 0, right: Infinity, ascent: 1, descent: 0 });
	await assert.rejects(withImageExportTextFrameV1(request(), () => undefined, h.options), /glyph/iu); assert.ok(!h.calls.includes('draw'));
	await assert.rejects(withImageExportTextFrameV1(request(), () => undefined, { ...h.options, maximumWorkingBytes: FONT.length }), /capacity/iu);
});

test('opaque rendering and private font cleanup failures are both preserved', async () => {
	const h = harness(), primary = Symbol('draw failure'), cleanup = Symbol('font close'); h.canvas.measure = () => { throw primary; };
	h.font.open = async family => ({ family, close() { throw cleanup; } });
	await assert.rejects(withImageExportTextFrameV1(request(), () => undefined, h.options), error => error instanceof AggregateError && error.cause === primary && error.errors.includes(primary) && error.errors.includes(cleanup));
});

test('modified native cancellation refuses without invoking shadow accessors or fetching a font', async () => {
	const h = harness(), stop = new AbortController(); let getters = 0;
	Object.defineProperty(stop.signal, 'aborted', { get() { getters++; return false; } });
	await assert.rejects(withImageExportTextFrameV1(request(TEXT, stop.signal), () => undefined, h.options), /native cancellation/iu);
	assert.equal(getters, 0); assert.deepEqual(h.calls, []);
});

test('held streamed font read joins cancellation and reader cleanup before refusing publication', async () => {
	const h = harness(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Symbol('read cancellation');
	let pulls = 0, cancelled = false, consumed = false;
	h.font.fetch = async () => new Response(new ReadableStream<Uint8Array>({
		async pull(controller) { if (pulls++ === 0) { entered.resolve(); await release.promise; controller.enqueue(FONT.slice()); } },
		cancel() { cancelled = true; },
	}));
	const work = withImageExportTextFrameV1(request(TEXT, stop.signal), () => { consumed = true; }, h.options);
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(work), true); release.resolve();
	await assert.rejects(work, error => error === reason); assert.equal(cancelled, true); assert.equal(consumed, false); assert.deepEqual(h.calls, []);
});

test('stream cancellation failure preserves the admission error and still releases its native reader lock', async () => {
	const h = harness(), cleanup = Symbol('stream cancel');
	const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(FONT.length + 1)); }, cancel() { throw cleanup; } }));
	h.font.fetch = async () => response;
	await assert.rejects(withImageExportTextFrameV1(request(), () => undefined, h.options), error => error instanceof AggregateError && error.errors[0] instanceof RangeError && error.errors[1] === cleanup);
	assert.equal(response.body!.locked, false);
});

test('refusing an invalid acquired canvas method still closes that owned canvas without invoking its getter', async () => {
	const h = harness(); let getters = 0;
	Object.defineProperty(h.canvas, 'measure', { get() { getters++; throw new Error('Foreign measure'); } });
	await assert.rejects(withImageExportTextFrameV1(request(), () => undefined, h.options), /data capability/u);
	assert.equal(getters, 0); assert.deepEqual(h.calls, ['fetch','font-open','canvas-close','font-close']);
});

test('actual FontFace and canvas adapters use the private pinned face and real text drawing, removing only owned resources', async t => {
	const originalFace = {}, faces = new Set<object>([originalFace]), events: string[] = [], loaded = deferred<void>(), release = deferred<void>();
	let faceBytes: Uint8Array | undefined, nativePixels: Uint8ClampedArray<ArrayBuffer> | undefined;
	const canvases: NativeCanvas[] = [];
	class Face {
		constructor(readonly family: string, bytes: Uint8Array, readonly descriptors: Readonly<{ weight: string; style: string }>) { faceBytes = bytes; assert.equal(faces.size, 1); }
		async load() { assert.deepEqual(this.descriptors, { style: 'normal', weight: '600' }); events.push('load'); loaded.resolve(); await release.promise; return this; }
	}
	const fonts = { add(face: Face) { assert.equal(this, fonts); faces.add(face); events.push('add'); }, delete(face: Face) { assert.equal(this, fonts); events.push('delete'); return faces.delete(face); } };
	class NativeCanvas {
		constructor(public width: number, public height: number) { canvases.push(this); }
		getContext(kind: string, options: unknown) { assert.equal(kind, '2d'); assert.deepEqual(options, { colorSpace: 'srgb', willReadFrequently: true });
			const context = { font: '', fillStyle: '', textBaseline: '', textAlign: '',
				measureText(text: string) { assert.equal(this, context); assert.equal(text, TEXT.text); assert.match(context.font, /^600 128px "scape-export-text-\d+"$/u); assert.equal(faces.size, 2); return { actualBoundingBoxLeft: 0, actualBoundingBoxRight: 8, actualBoundingBoxAscent: 2, actualBoundingBoxDescent: 0 }; },
				fillText(text: string, x: number, y: number) { assert.equal(this, context); assert.equal(text, TEXT.text); assert.equal(context.fillStyle, '#ffffff'); assert.match(context.font, /^600 144px "scape-export-text-\d+"$/u); assert.deepEqual([x,y], [0,2.25]); events.push('fillText'); },
				getImageData(x: number, y: number, width: number, height: number) { assert.equal(this, context); assert.deepEqual([x,y,width,height], [0,0,9,3]); nativePixels = new Uint8ClampedArray(width * height * 4).fill(255); return { data: nativePixels }; },
			}; return context;
		}
	}
	globals(t, { fetch: async () => new Response(FONT.slice()), FontFace: Face, document: { fonts }, OffscreenCanvas: NativeCanvas });
	const work = withImageExportTextFrameV1(request(), frame => { assert.ok(frame); assert.deepEqual(events, ['load','add','fillText','delete']); assert.deepEqual([...faces], [originalFace]);
		assert.equal(canvases[0]!.width, 0); assert.equal(canvases[0]!.height, 0); assert.ok(faceBytes!.every(byte => byte === 0)); assert.ok(nativePixels!.every(byte => byte === 0)); });
	await loaded.promise; assert.equal(await remainsPending(work), true); assert.deepEqual([...faces], [originalFace]); release.resolve(); await work;
});

for (const cleanupFails of [false, true]) test(`native font add refusal retires a partially-added private face and preserves cleanup failure=${String(cleanupFails)}`, async t => {
	const primary = Symbol('native add'), cleanup = Symbol('native delete'), original = {}, faces = new Set<object>([original]); let transport: Uint8Array | undefined;
	class Face { constructor(readonly family: string, bytes: Uint8Array) { transport = bytes; } async load() { return this; } }
	const fonts = { add(face: Face) { faces.add(face); throw primary; }, delete(face: Face) { faces.delete(face); if (cleanupFails) throw cleanup; return true; } };
	globals(t, { fetch: async () => new Response(FONT.slice()), FontFace: Face, document: { fonts } });
	const h = harness();
	await assert.rejects(withImageExportTextFrameV1(request(), () => assert.fail('Partial font must not publish'), { createCanvas: () => h.canvas }),
		error => cleanupFails ? error instanceof AggregateError && error.cause === primary && error.errors[0] === primary && error.errors[1] === cleanup : error === primary);
	assert.deepEqual([...faces], [original]); assert.ok(transport!.every(byte => byte === 0)); assert.deepEqual(h.calls, []);
});

for (const [failure, cleanupFails] of [['context',false],['binding',false],['context',true]] as const) test(`native canvas ${failure} refusal retires both dimensions and preserves cleanup failure=${String(cleanupFails)}`, async t => {
	const primary = Symbol('native canvas acquisition'), cleanup = Symbol('native width cleanup'), cleared: string[] = [];
	class Canvas {
		constructor(_width: number, _height: number) {}
		set width(_value: number) { cleared.push('width'); if (cleanupFails) throw cleanup; }
		set height(_value: number) { cleared.push('height'); }
		getContext() { if (failure === 'context') throw primary; return Object.defineProperty({}, 'measureText', { get() { throw primary; } }); }
	}
	globals(t, { OffscreenCanvas: Canvas, document: undefined }); const h = harness();
	await assert.rejects(withImageExportTextFrameV1(request(), () => assert.fail('Partial canvas must not publish'), { font: h.font }),
		error => cleanupFails ? error instanceof AggregateError && error.cause === primary && error.errors[0] === primary && error.errors[1] === cleanup : error === primary);
	assert.deepEqual(cleared, ['width','height']); assert.deepEqual(h.calls, ['fetch','font-open','font-close']); assert.ok(h.transports[0]!.every(byte => byte === 0));
});

test('the existing linear compositor pays literal sRGB and Rec709 coverage without changing the borrowed source', async () => {
	const limits = { maximumSidePixels: 10, maximumPixels: 100, maximumBytes: 400 };
	for (const [transfer, expected] of [['srgb',188],['bt709',180]] as const) {
		const pixels = Uint8Array.of(0,0,0,255), graphic = Uint8Array.of(255,255,255,255);
		await withGraphicWatermarkPixelFrameV1({ frame: { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: transfer === 'srgb' ? 'srgb' : 'bt709', transfer }, pixels },
			graphic: { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: graphic },
			placement: imageExportGraphicPlacement({ ...TEXT, opacity: .5 }, 1, 1) }, output => assert.deepEqual([...output.pixels], [expected,expected,expected,255]), { limits, maximumWorkingBytes: 65_536 });
		assert.deepEqual([...pixels], [0,0,0,255]); assert.deepEqual([...graphic], [255,255,255,255]);
	}
});

test('only the two exact native text leaves acquire the optional font/mask semantic owner', () => {
	for (const separator of ['/', '\\']) for (const leaf of ['image-export-text-font-v1', 'image-export-text-frame-v1']) {
		const path = `src/common/editor/imaging/${leaf}.ts`.replaceAll('/', separator);
		assert.equal(imagingChunkGroups.find(group => group.test instanceof RegExp && group.test.test(path))?.name, 'editor-export-text');
	}
	const text = imagingChunkGroups.find(group => group.name === 'editor-export-text'); assert.ok(text);
	assert.ok(text.test instanceof RegExp); const pattern = text.test;
	assert.equal(text.maxSize, 400_000); assert.equal(text.includeDependenciesRecursively, false);
	for (const name of ['image-export-text-font-v2.ts', 'image-export-text-frame-v1-extra.ts', 'nested/image-export-text-font-v1.ts']) assert.equal(pattern.test(`src/common/editor/imaging/${name}`), false);
});

function range(start: number, end: number) { return Array.from({ length: end - start + 1 }, (_, index) => start + index); }
function globals(t: TestContext, values: Readonly<Record<string, unknown>>) {
	const prior = Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
	t.after(() => { for (const [key, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } });
}
function glyph(woff: Buffer, code: number): number {
	let cmap: Buffer | undefined;
	for (let row = 0; row < woff.readUInt16BE(12); row++) { const offset = 44 + row * 20;
		if (woff.toString('ascii', offset, offset + 4) === 'cmap') { const data = woff.subarray(woff.readUInt32BE(offset + 4), woff.readUInt32BE(offset + 4) + woff.readUInt32BE(offset + 8));
			cmap = data.length === woff.readUInt32BE(offset + 12) ? data : inflateSync(data); } }
	assert.ok(cmap);
	for (let row = 0; row < cmap.readUInt16BE(2); row++) { const table = cmap.readUInt32BE(8 + row * 8); if (cmap.readUInt16BE(table) !== 4) continue;
		const count = cmap.readUInt16BE(table + 6) / 2, ends = table + 14, starts = ends + count * 2 + 2, deltas = starts + count * 2, offsets = deltas + count * 2;
		for (let segment = 0; segment < count; segment++) if (code >= cmap.readUInt16BE(starts + segment * 2) && code <= cmap.readUInt16BE(ends + segment * 2)) {
			const delta = cmap.readInt16BE(deltas + segment * 2), offset = cmap.readUInt16BE(offsets + segment * 2);
			if (!offset) return (code + delta) & 0xffff;
			const index = offsets + segment * 2 + offset + (code - cmap.readUInt16BE(starts + segment * 2)) * 2, value = cmap.readUInt16BE(index); return value ? (value + delta) & 0xffff : 0;
		} }
	return 0;
}
