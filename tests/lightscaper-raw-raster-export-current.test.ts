/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { PhotoRasterExportCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import { PhotoRasterExport } from '../src/lightscaper/controller/photo-raster-export.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import { encodePixelFramePng16V1 } from '../src/common/editor/imaging/pixel-frame-png16-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { PhotoRasterExportRequestCurrentV1 } from '../src/lightscaper/controller/photo-raster-export-contract-v1.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
import { decodePng, repairRasterFixture } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { withPhotoRasterLinearOutputCurrentV1 } from '../src/lightscaper/controller/internal/photo-raster-export-linear-current-v1.ts';
import { readImageMetadataV1 } from '../src/common/editor/imaging/image-metadata-reader-v1.ts';

function encoded(value: number, maximum = 255): number {
	const linear = Math.max(0, Math.min(1, value));
	return Math.round(maximum * (linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055));
}
function decode16(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), width = view.getUint32(16), height = view.getUint32(20);
	assert.equal(bytes[24], 16); assert.equal(bytes[25], 6); const chunks: Uint8Array[] = [];
	for (let offset = 8; offset < bytes.length;) { const length = view.getUint32(offset);
		if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length)); offset += length + 12;
	}
	const rows = inflateSync(Buffer.concat(chunks)), samples: number[] = [], stride = width * 8 + 1;
	assert.equal(rows.length, stride * height);
	for (let y = 0; y < height; y++) { assert.equal(rows[y * stride], 0); for (let x = 0; x < width * 4; x++) samples.push(rows.readUInt16BE(y * stride + 1 + x * 2)); }
	return { width, height, samples };
}
const OUTPUT16 = { schemaVersion: 2 as const, bitDepth: 16 as const, sizing: { kind: 'original' as const }, quality: 'nearest' as const };

async function nativeExportFixture() {
	const f = await repairSettingsFixture(1), workers = await rawWorkerFixtureV1();
	const previous = ['Worker', 'fetch'].map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	try {
		const wasm = new Uint8Array(await readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url)));
		Object.defineProperty(globalThis, 'Worker', { configurable: true, value: function () { return workers.createWorker(); } });
		Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (value: RequestInfo | URL) => {
			assert.equal(String(value), 'https://assets.soundscaper.org/runtime/libraw/0.22.2/libraw.wasm'); return new Response(wasm);
		} });
		const raw = rawDngFixtureV1().bytes;
		const imported = await f.session.importFiles([new File([raw], 'Native.DNG', { type: 'image/png' })]);
		assert.equal(imported[0]?.status, 'imported'); const photoId = imported[0]?.photoId; assert.ok(photoId);
		const saved = await f.session.develop.read({ schemaVersion: 3, photoId });
		const bound = { schemaVersion: 1 as const, photoId, expectedRevision: saved.revision };
		const original = f.session.develop.original!;
		const words = await original.withFrame(bound, view => { assert.equal(view.frame.descriptor.sampleFormat, 'unorm16'); return [...view.frame.pixels]; });
		const runtime = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
		const events: string[] = [], deliveries: Uint8Array[] = [], encodedBuffers: Uint8Array[] = [];
		const request: PhotoRasterExportRequestCurrentV1 = { photoId, versionId: saved.versionId, expectedRevision: saved.revision,
			fileName: 'Native', fileTypeDescription: 'PNG', execute: f.execute,
			withOriginalFrame: async (request, consume, options) => { events.push('original'); const result = await original.withFrame(request, consume, options); events.push('original-settled'); return result; },
			loadRenderer: async () => runtime,
			encode: async (frame, { bitDepth, ...options }) => { events.push('encode'); const bytes = await (bitDepth === 16 ? encodePixelFramePng16V1 : encodePixelFramePngV1)(frame, options); encodedBuffers.push(bytes); return bytes; },
			prepareSave: value => { events.push('picker'); const name = value.suggestedName; assert.equal(typeof name, 'string'); return { mode: 'blob', target: { browserDownload: true, name: name as string }, fileName: name as string }; },
			saveFile: async value => { assert.ok(value.blob); events.push('download'); deliveries.push(new Uint8Array(await value.blob.arrayBuffer()));
				assert.equal(typeof value.suggestedName, 'string'); return { method: 'download', fileName: value.suggestedName as string, size: value.blob.size }; },
		};
		return { ...f, workers, raw, words, saved, original, bound, events, deliveries, encodedBuffers, request,
			async close() { try { await f.close(); } finally { try { await workers.close(); } finally {
				for (const [index, key] of ['Worker', 'fetch'].entries()) { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
			} } },
		};
	} catch (error) {
		try { await f.close(); } finally { await workers.close(); for (const [index, key] of ['Worker', 'fetch'].entries()) { const descriptor = previous[index]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
		throw error;
	}
}

test('Current RAW default PNG8 converts native developed pixels once at the codec boundary and joins Original custody', { timeout: 20_000 }, async () => {
	const f = await nativeExportFixture(), owner = new PhotoRasterExportCurrentV1('png');
	try {
		const work = owner.start(f.request); assert.deepEqual(f.events, ['picker']); const receipt = await work;
		assert.equal(receipt.status, 'download-started'); assert.deepEqual([receipt.width, receipt.height], [32, 32]);
		const expected = f.words.map((value, index) => index % 4 === 3 ? Math.round(value * 255 / 65535) : encoded(value / 65535));
		assert.deepEqual([...decodePng(f.deliveries[0]!).pixels], expected);
		assert.ok(f.events.indexOf('download') > f.events.indexOf('original-settled'));
		assert.ok(f.encodedBuffers.every(bytes => bytes.every(value => value === 0)));
		assert.deepEqual(await f.original.withFrame(f.bound, view => [...view.frame.pixels]), f.words);
		assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId: f.bound.photoId }), f.saved);
		assert.equal(f.workers.active(), 0); assert.equal(f.workers.statistics.created, f.workers.statistics.joined);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Current PNG16 exports an actual retained DNG with full native adjacent-code precision', { timeout: 20_000 }, async () => {
	const f = await nativeExportFixture(), owner = new PhotoRasterExportCurrentV1('png');
	try {
		await owner.start({ ...f.request, output: OUTPUT16 });
		const result = decode16(f.deliveries[0]!);
		assert.deepEqual([result.width, result.height], [32, 32]);
		const expected = f.words.map((value, index) => index % 4 === 3 ? value : encoded(Math.fround(value / 65535), 65535));
		assert.deepEqual(result.samples, expected);
		const left = (8 * 32 + 8) * 4, right = (8 * 32 + 24) * 4;
		assert.notEqual(result.samples[left], result.samples[right]);
		assert.equal(Math.round(result.samples[left]! / 257), Math.round(result.samples[right]! / 257));
		assert.ok(result.samples.some((value, index) => index % 4 !== 3 && value % 257 !== 0));
		assert.deepEqual(await f.original.withFrame(f.bound, view => [...view.frame.pixels]), f.words);
		assert.ok(f.encodedBuffers.every(bytes => bytes.every(value => value === 0)));
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('actual Current RAW PNG16 Capture metadata preserves native samples and stored camera facts', { timeout: 20_000 }, async () => {
	const f = await nativeExportFixture(), owner = new PhotoRasterExportCurrentV1('png');
	try {
		const before = await f.session.readMetadata(f.bound.photoId);
		await owner.start({ ...f.request, output: { ...OUTPUT16, metadataScope: 'capture' },
			readMetadata: async (photoId, expectedRevision, options) => { const snapshot = await f.session.readMetadata(photoId, options);
				assert.equal(snapshot.revision, expectedRevision); return { catalogId: f.saved.catalogId, snapshot }; } });
		assert.deepEqual(decode16(f.deliveries[0]!).samples, f.words.map((value, index) => index % 4 === 3 ? value : encoded(Math.fround(value / 65535), 65535)));
		const facts = readImageMetadataV1(f.deliveries[0]!); assert.deepEqual(facts.issues, []); assert.equal(facts.exif?.orientation, 1);
		assert.equal(facts.exif?.cameraMake, before.extracted?.exif?.cameraMake ?? null); assert.equal(facts.exif?.artist, null);
		assert.deepEqual(await f.session.readMetadata(f.bound.photoId), before); assert.deepEqual(await f.original.withFrame(f.bound, view => [...view.frame.pixels]), f.words);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('native output sizing and graphic overlay follow saved HDR Develop before final PNG16 clipping', { timeout: 20_000 }, async () => {
	const f = await nativeExportFixture(), owner = new PhotoRasterExportCurrentV1('png');
	try {
		await f.session.develop.apply({ schemaVersion: 3, photoId: f.bound.photoId, expectedRevision: f.saved.revision,
			command: { type: 'record-develop', versionId: f.saved.versionId, label: 'HDR', createdAt: '2026-10-17T00:00:00.000Z',
				develop: normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('tone-ladder-v1', { id: 'exposure', params: { exposure: 2 } })] }) } });
		const saved = await f.session.develop.read({ schemaVersion: 3, photoId: f.bound.photoId });
		const mark = { descriptor: { schemaVersion: 1 as const, width: 1, height: 1, sampleFormat: 'unorm8' as const, transfer: 'srgb' as const, primaries: 'srgb' as const }, pixels: Uint8Array.of(0, 0, 0, 128) };
		await owner.start({ ...f.request, expectedRevision: saved.revision, output: { ...OUTPUT16, sizing: { kind: 'percentage', percentage: 6.25 } },
			graphicWatermark: { body: new Blob(['owned graphic']), anchor: 'middle-center', widthFraction: 1, marginFraction: 0, opacity: 1 },
			withGraphicFrame: async (_request, consume) => consume(mark, { orientation: 1, runtimeVersion: 'owned-graphic' }) });
		const expected: number[] = [];
		for (const y of [0, 16]) for (const x of [0, 16]) for (let channel = 0; channel < 4; channel++) {
			const native = Math.fround(f.words[(y * 32 + x) * 4 + channel]! / 65535);
			expected.push(channel === 3 ? 65535 : encoded(Math.fround(Math.fround(native * 4) * (1 - 128 / 255)), 65535));
		}
		const result = decode16(f.deliveries[0]!); assert.deepEqual([result.width, result.height], [2, 2]); assert.deepEqual(result.samples, expected);
		// Clipping the developed HDR plane before the mark would leave every
		// output channel at most the encoded half-opacity remainder.
		assert.ok(result.samples.some((value, index) => index % 4 !== 3 && value > encoded(1 - 128 / 255, 65535)));
		assert.deepEqual(await f.original.withFrame({ ...f.bound, expectedRevision: saved.revision }, view => [...view.frame.pixels]), f.words);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('JPEG16 and the permanent legacy output owner refuse explicit depth before invoking a picker', async () => {
	const f = await nativeExportFixture(), owner = new PhotoRasterExportCurrentV1('jpeg'), legacy = new PhotoRasterExport('png');
	try { await assert.rejects(owner.start({ ...f.request, output: OUTPUT16 }), /PNG/iu);
		await assert.rejects(Reflect.apply(legacy.start, legacy, [{ ...f.request, output: OUTPUT16 }]) as Promise<unknown>); assert.deepEqual(f.events, []);
	} finally { await owner.cancelAndJoin(); await legacy.cancelAndJoin(); await f.close(); }
});

test('explicit PNG16 promotes an ordinary encoded raster before Current Develop and preserves its literal codes', async () => {
	const f = await repairRasterFixture(defaultImageDevelopStateV2(), [73, 74, 75, 255]), owner = new PhotoRasterExportCurrentV1('png');
	try {
		const runtime = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
		await owner.start({ ...f.request(), output: OUTPUT16, loadRenderer: async () => runtime,
			encode: (frame, { bitDepth, ...options }) => { assert.equal(bitDepth, 16); assert.equal(frame.descriptor.sampleFormat, 'float32'); return encodePixelFramePng16V1(frame, options); } });
		assert.deepEqual(decode16(f.outputs[0]!.bytes), { width: 1, height: 1, samples: [18761, 19018, 19275, 65535] });
		assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('native output cancellation joins the actual held codec consumer before wiping its Float32 plane', { timeout: 20_000 }, async () => {
	const f = await nativeExportFixture(), owner = new PhotoRasterExportCurrentV1('png'), entered = deferred<void>(), release = deferred<void>();
	const primary = Proxy.revocable({}, {}); primary.revoke(); let borrowed: Float32Array | undefined;
	const work = owner.start({ ...f.request, output: { ...OUTPUT16, sizing: { kind: 'percentage', percentage: 50 } }, encode: async (frame, { bitDepth: _depth, ...options }) => {
		assert.ok(frame.pixels instanceof Float32Array); borrowed = frame.pixels; entered.resolve(); await release.promise; return encodePixelFramePng16V1(frame, options);
	} });
	const outcome = work.then(value => ({ value }), (error: unknown) => ({ error }));
	try {
		await Promise.race([entered.promise, work.then(() => assert.fail('No native codec consumer entered'))]);
		const retirement = owner.cancelAndJoin(primary.proxy); assert.equal(await remainsPending(retirement), true); assert.ok(borrowed?.some(value => value !== 0));
		release.resolve(); await retirement; const result = await outcome; assert.ok('error' in result); assert.equal(result.error, primary.proxy);
		assert.ok(borrowed?.every(value => value === 0)); assert.equal(f.deliveries.length, 0);
		assert.deepEqual(await f.original.withFrame(f.bound, view => [...view.frame.pixels]), f.words);
	} finally { release.resolve(); await outcome; await owner.cancelAndJoin(); await f.close(); }
});

test('native encoder cannot alias a Float32 output through a forged delivered buffer property', { timeout: 20_000 }, async () => {
	const f = await nativeExportFixture(), owner = new PhotoRasterExportCurrentV1('png'); let borrowed: Float32Array | undefined;
	try {
		await assert.rejects(owner.start({ ...f.request, output: { ...OUTPUT16, sizing: { kind: 'percentage', percentage: 50 } }, encode: frame => {
			assert.ok(frame.pixels instanceof Float32Array); borrowed = frame.pixels; const real = frame.pixels.buffer;
			Object.defineProperty(frame.pixels, 'buffer', { configurable: true, value: new ArrayBuffer(0) }); return Promise.resolve(new Uint8Array(real));
		} }), /independent/iu);
		assert.ok(borrowed?.every(value => value === 0)); assert.equal(f.deliveries.length, 0);
		assert.deepEqual(await f.original.withFrame(f.bound, view => [...view.frame.pixels]), f.words);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('native output orders resizing, output sharpening, graphic and glyph before its joined codec', async () => {
	const descriptor = { schemaVersion: 1 as const, width: 3, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const };
	const pixels = Float32Array.from([.25, .25, .25, 1, .5, .5, .5, 1, .75, .75, .75, 1]), before = pixels.slice(), frame = { descriptor, pixels };
	const graphic = { descriptor: { ...descriptor, width: 1, sampleFormat: 'unorm8' as const, transfer: 'srgb' as const }, pixels: Uint8Array.of(255, 0, 0, 128) };
	const glyph = { ...graphic, pixels: Uint8Array.of(0, 0, 255, 255) }, marker = { body: new Blob(['graphic']), anchor: 'middle-left' as const, widthFraction: 1 / 6, marginFraction: 0, opacity: 1 };
	const gray = [.25, .25, .5, .5, .75, .75], encode = (value: number) => 1.055 * value ** (1 / 2.4) - .055;
	const decode = (value: number) => ((value + .055) / 1.055) ** 2.4;
	const sharpened = gray.map((value, x) => { const center = encode(value), blur = (encode(gray[Math.max(0, x - 1)]!) + center * 2 + encode(gray[Math.min(5, x + 1)]!)) / 4; return Math.fround(decode(center + (center - blur) * .5)); });
	const expected = new Float32Array(6 * 2 * 4);
	for (let y = 0; y < 2; y++) for (let x = 0; x < 6; x++) { const value = sharpened[x]!; expected.set([value, value, value, 1], (y * 6 + x) * 4); }
	const alpha = 128 / 255; expected.set([Math.fround(alpha + sharpened[0]! * (1 - alpha)), Math.fround(sharpened[0]! * (1 - alpha)), Math.fround(sharpened[0]! * (1 - alpha)), 1], 0);
	expected.set([0, 0, 1, 1], 5 * 4);
	let delivered: Float32Array | undefined, glyphUses = 0;
	await withPhotoRasterLinearOutputCurrentV1({ frame, originals: [frame], bitDepth: 16, signal: new AbortController().signal, current: () => {},
		output: { ...OUTPUT16, sizing: { kind: 'percentage', percentage: 200 }, sharpen: { amount: 50, threshold: 0 },
			textWatermark: { schemaVersion: 1, font: 'inter-600-latin', text: 'Glyph', color: '#0000ff', anchor: 'middle-right', widthFraction: 1 / 6, marginFraction: 0, opacity: 1 } },
		graphic, graphicWatermark: marker, withTextFrame: async (_request, consume) => { glyphUses++; return consume(glyph); },
	}, async (output, _limits, maximum, borrowed) => { assert.ok(output.pixels instanceof Float32Array); delivered = output.pixels;
		assert.deepEqual([output.descriptor.width, output.descriptor.height], [6, 2]); assert.deepEqual(output.pixels, expected);
		assert.ok(borrowed.some(view => view.pixels === glyph.pixels)); assert.ok(maximum > 1_048_576); await Promise.resolve(); assert.deepEqual(output.pixels, expected);
	});
	assert.equal(glyphUses, 1); assert.ok(delivered?.every(value => value === 0)); assert.deepEqual(pixels, before); assert.deepEqual([...graphic.pixels], [255, 0, 0, 128]);
});
