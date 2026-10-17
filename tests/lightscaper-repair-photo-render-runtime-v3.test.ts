/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { createPhotoLibraryDevelopOriginalSessionCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-current-v1.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { applyPhotoCommandCurrentV1 } from '../src/lightscaper/controller/photo-commands-current-v1.ts';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { pngChunk } from './helpers/image-metadata-fixtures.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { gradientGraph, LUT_BODY, LUT_REFERENCE, profile } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function repair(width: number, targetX = 1.5 / width, sourceX = 0.5 / width) {
	return { id: 'repair', mode: 'clone', enabled: true, target: { x: targetX, y: 0.5 }, source: { x: sourceX, y: 0.5 }, radius: 0.1, feather: 0, opacity: 1 };
}
function develop(spots: readonly unknown[]) { return { ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots } }; }
function invert() { return createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }); }
function encodedOriginal(pixels: readonly number[], height = 1): Uint8Array<ArrayBuffer> {
	const width = pixels.length / (height * 4), header = new Uint8Array(13), view = new DataView(header.buffer);
	assert.equal(Number.isInteger(width), true); view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6], 8);
	const rows = new Uint8Array(pixels.length + height);
	for (let y = 0; y < height; y++) rows.set(pixels.slice(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
		pngChunk('IDAT', new Uint8Array(deflateSync(rows))), pngChunk('IEND', new Uint8Array())]));
}
/** The injected decoder consumes genuine encoded fixture bytes below the actual
 * original SHA/length/orientation owner. It does not replace that owner. */
function decodeFixture(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const chunks: Uint8Array[] = [];
	for (let offset = 8; offset < bytes.length;) {
		const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
		if (String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
		offset += length + 12;
	}
	const width = new DataView(bytes.buffer, bytes.byteOffset + 16, 8).getUint32(0), height = new DataView(bytes.buffer, bytes.byteOffset + 16, 8).getUint32(4);
	const decoded = inflateSync(Buffer.concat(chunks)), pixels = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) { const offset = y * (width * 4 + 1); assert.equal(decoded[offset], 0); pixels.set(decoded.subarray(offset + 1, offset + 1 + width * 4), y * width * 4); }
	return pixels;
}
function fixture(pixels: readonly number[], recipe: unknown, height = 1) {
	const bytes = encodedOriginal(pixels, height), seed = photoArchiveFixture(1, bytes), width = pixels.length / (height * 4);
	let photo = applyPhotoCommandCurrentV1(normalizePhotoDocumentCurrentV1({ ...seed.photo,
		original: { ...seed.photo.original, width, height, hasAlpha: pixels.some((value, index) => index % 4 === 3 && value !== 255) } }), { type: 'set-develop', develop: recipe });
	const lifetime = new PhotoLibrarySessionLifetime(), borrowed: PixelFrameV1[] = [], decoderBuffers: Uint8Array[] = [];
	const calls = { bodies: 0, opens: 0, closes: 0, cleanup: 0 }, hooks = { body: seed.original };
	const port = createPhotoLibraryDevelopOriginalSessionCurrentV1({ repository: { loadPhoto: async () => photo }, ready: async () => 'catalog-1',
		operation: (run, signal) => lifetime.operation(run, signal), loadOriginal: async () => { calls.bodies++; return hooks.body; },
		withFrame: (value, consume) => withPhotoOriginalFrameV1(value, async frame => { borrowed.push(frame); return consume(frame, { orientation: 1, runtimeVersion: 'fixture-native' }); },
			{ openImage: async request => { calls.opens++; decoderBuffers.push(request.bytes); return {
				metadata: { width, height, frameCount: 1, topology: 'single', runtimeVersion: 'fixture-native' },
				decodeFrame: async () => ({ rgba: decodeFixture(request.bytes), durationMicroseconds: null }), close() { calls.closes++; },
			}; } }),
	});
	const close = () => lifetime.close(async () => { calls.cleanup++; });
	const read = <Result>(consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>) =>
		port.withFrame({ schemaVersion: 1, photoId: 'photo-1', expectedRevision: photo.revision }, view => consume(view.frame));
	return { bytes, seed, port, lifetime, borrowed, decoderBuffers, hooks, calls, close, read,
		changeRevision() { photo = normalizePhotoDocumentCurrentV1({ ...photo, revision: photo.revision + 1 }); } };
}
async function brush(alpha: number) {
	return withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(alpha) }, value => ({ reference: value.reference, bytes: value.bytes.slice() }));
}
function brushGraph(sourceRef: string, id = 'mask') { return { schemaVersion: 1, id, kind: 'matte', inputs: [{ name: 'paint', sourceRef, kind: 'alpha' }],
	nodes: [{ id: 'painted', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'painted' }; }
async function enteredBeforeSettlement(work: Promise<unknown>, entered: Promise<void>): Promise<void> {
	await Promise.race([entered, work.then(() => { assert.fail('The real borrowed resource settled before entering.'); }, (error: unknown) => { throw error; })]);
}

test('Photo runtime3 renders authenticated repaired originals before real range/LUT stages in both unchanged Photo profiles', async () => {
	const range = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [{ id: 'range', kind: 'color-range', color: { r: 1, g: 0, b: 0 }, radius: 0, falloff: 0 }], outputNodeId: 'range' };
	const recipe = { ...develop([repair(3)]), effects: [profile(), invert()], masks: [range],
		maskBindings: [{ effectId: 'profile', maskId: 'mask' }, { effectId: 'invert', maskId: 'mask' }] };
	const f = fixture([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255], recipe); let reads = 0;
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume) { assert.equal(this, source); assert.deepEqual(reference, LUT_REFERENCE); reads++; return consume(LUT_BODY); } };
	try {
		const runtime = createPhotoDevelopRenderRuntimeV3({ source });
		for (const method of ['withProxy', 'withFullResolution'] as const) for (const [effectId, coverage] of [['profile', [255, 255, 0]], ['invert', [0, 0, 0]]] as const) {
			const actual = await f.read(frame => runtime[method]({ frame, develop: normalizePhotoDocumentCurrentV1(applyPhotoCommandCurrentV1(f.seed.photo, { type: 'set-develop', develop: recipe })).versions[0]!.develop,
				signal: f.lifetime.signal, maskOverlay: { maskId: 'mask', effectId } }, view => {
				assert.ok(view.maskOverlay); return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage] };
			}));
			assert.deepEqual(actual, { pixels: [137, 0, 0, 255, 137, 0, 0, 255, 0, 0, 0, 255], coverage });
		}
		assert.equal(reads, 4); assert.equal(f.calls.closes, 4); assert.ok(f.borrowed.every(frame => frame.pixels.every(value => value === 0)));
		assert.ok(f.decoderBuffers.every(bytes => bytes.every(value => value === 0))); assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
		assert.equal(LUT_BODY[0], 76);
	} finally { await f.close(); }
});

test('Photo runtime3 forwards actual borrowed suffix-projected coverage and preserves independent alpha/pixel literals', async () => {
	const crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 0.5 } });
	const flip = createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } });
	const recipe = { ...develop([repair(4)]), effects: [crop, invert(), flip], masks: [gradientGraph()], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	const f = fixture([255, 255, 255, 255, 0, 0, 0, 128, 0, 0, 0, 255, 0, 0, 0, 255], recipe), buffers: PixelFrameV1['pixels'][] = [];
	try {
		const runtime = createPhotoDevelopRenderRuntimeV3();
		const actual = await f.read(frame => runtime.withFullResolution({ frame, develop: applyPhotoCommandCurrentV1(f.seed.photo, { type: 'set-develop', develop: recipe }).versions[0]!.develop,
			signal: f.lifetime.signal, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
			assert.ok(view.maskOverlay); buffers.push(view.frame.pixels, view.maskOverlay.coverage);
			return { pixels: [...view.frame.pixels], coverage: [...view.maskOverlay.coverage], width: view.frame.descriptor.width, overlayWidth: view.maskOverlay.width };
		}));
		// Quantized64/255 leaves191/255 white -> sRGB224;191/255 leaves64/255 ->137.
		assert.deepEqual(actual, { pixels: [137, 137, 137, 128, 224, 224, 224, 255], coverage: [191, 64], width: 2, overlayWidth: 2 });
		assert.ok(buffers.every(value => value.every(byte => byte === 0))); assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
	} finally { await f.close(); }
});

test('Photo runtime3 Heal and donor movement use authenticated encoded 11x3 originals with independent boundary goldens', async () => {
	const pixels: number[] = [];
	for (let y = 0; y < 3; y++) for (let x = 0; x < 11; x++) {
		const gray = x < 3 ? 32 : x >= 4 && x < 7 ? 64 : x >= 8 ? 128 : 0; pixels.push(gray, gray, gray, 255);
	}
	pixels.splice(12 * 4, 4, 64, 64, 64, 255); pixels.splice(16 * 4, 4, 192, 192, 192, 255); pixels.splice(20 * 4, 4, 0, 0, 0, 255);
	for (const [sourceX, expected] of [[1.5 / 11, 138], [5.5 / 11, 217]] as const) {
		const recipe = develop([{ ...repair(11, 9.5 / 11, sourceX), mode: 'heal', radius: 0.2 }]), f = fixture(pixels, recipe, 3);
		try {
			const runtime = createPhotoDevelopRenderRuntimeV3(), state = applyPhotoCommandCurrentV1(f.seed.photo, { type: 'set-develop', develop: recipe }).versions[0]!.develop;
			for (const method of ['withProxy', 'withFullResolution'] as const) {
				const actual = await f.read(frame => runtime[method]({ frame, develop: state, signal: f.lifetime.signal }, view => [...view.frame.pixels]));
				// Screened single-cell solutions: D(128)+D(64)-D(32), or D(128)+D(192)-D(64).
				const literal = [...pixels]; literal.splice(20 * 4, 4, expected, expected, expected, 255); assert.deepEqual(actual, literal);
			}
			assert.equal(f.calls.closes, 2); assert.ok(f.borrowed.every(frame => frame.pixels.every(value => value === 0)));
			assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
		} finally { await f.close(); }
	}
});

test('Photo runtime3 captures selected brush receiver before yields and snapshots authenticated original pixels before held source work', async () => {
	const asset = await brush(64), unused = await brush(255), entered = deferred<void>(), release = deferred<void>();
	const recipe = { ...develop([repair(2)]), effects: [invert()], masks: [brushGraph(asset.reference.storageKey), brushGraph(unused.reference.storageKey, 'unused')],
		maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	const f = fixture([255, 255, 255, 255, 0, 0, 0, 255], recipe), scopes: Uint8Array[] = [], retired: string[] = []; let active = 0, maximum = 0, metadata = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, source); active++; maximum = Math.max(maximum, active);
		const bytes = (reference.storageKey === asset.reference.storageKey ? asset.bytes : unused.bytes).slice(); scopes.push(bytes);
		try { if (scopes.length === 1) { entered.resolve(); await release.promise; } return await consume(bytes); }
		finally { bytes.fill(0); active--; retired.push(reference.storageKey); }
	} };
	source.withBytes = new Proxy(source.withBytes, { get() { metadata++; throw Error('Source callable metadata inspected'); } });
	const options = { maskSource: source }, runtime = createPhotoDevelopRenderRuntimeV3(options), work: { value?: Promise<unknown> } = {};
	try {
		work.value = f.read(frame => runtime.withFullResolution({ frame, develop: applyPhotoCommandCurrentV1(f.seed.photo, { type: 'set-develop', develop: recipe }).versions[0]!.develop,
			signal: f.lifetime.signal }, view => { assert.equal(active, 0); assert.equal(retired.length, 2); return [...view.frame.pixels]; }));
		await enteredBeforeSettlement(work.value, entered.promise);
		f.borrowed[0]!.pixels.fill(0); Reflect.set(options, 'maskSource', { withBytes() { assert.fail('Replacement source acquired'); } });
		Reflect.set(source, 'withBytes', () => { assert.fail('Replacement receiver method acquired'); }); release.resolve();
		assert.deepEqual(await work.value, [224, 224, 224, 255, 224, 224, 224, 255]);
		assert.equal(maximum, 1); assert.equal(metadata, 0); assert.ok(scopes.every(bytes => bytes.every(value => value === 0)));
		assert.deepEqual(new Set(retired), new Set([asset.reference.storageKey, unused.reference.storageKey])); assert.equal(asset.bytes[16], 64);
		assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
	} finally { release.resolve(); await Promise.allSettled(work.value ? [work.value] : []); await f.close(); }
});

test('Photo runtime3 cancellation and Close join held authenticated brush borrowing without delivering or changing originals', async () => {
	const asset = await brush(255), entered = deferred<void>(), release = deferred<void>(), reason = Proxy.revocable({}, {}); reason.revoke();
	const recipe = { ...develop([repair(2)]), effects: [invert()], masks: [brushGraph(asset.reference.storageKey)], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	const f = fixture([255, 255, 255, 255, 0, 0, 0, 255], recipe), scopes: Uint8Array[] = []; let deliveries = 0;
	const source: MaskRasterSourcePortV1 = { async withBytes(_reference, consume) {
		const bytes = asset.bytes.slice(); scopes.push(bytes); entered.resolve(); await release.promise;
		try { return await consume(bytes); } finally { bytes.fill(0); }
	} };
	const work: { value?: Promise<unknown> } = {};
	try {
		const runtime = createPhotoDevelopRenderRuntimeV3({ maskSource: source }), stop = new AbortController();
		work.value = f.port.withFrame({ schemaVersion: 1, photoId: 'photo-1', expectedRevision: 0 }, original => runtime.withFullResolution({ frame: original.frame,
			develop: applyPhotoCommandCurrentV1(f.seed.photo, { type: 'set-develop', develop: recipe }).versions[0]!.develop, signal: stop.signal }, () => { deliveries++; }), { signal: stop.signal });
		const outcome = work.value.then(() => ({ error: undefined }), (error: unknown) => ({ error }));
		await enteredBeforeSettlement(work.value, entered.promise); stop.abort(reason.proxy); const closing = f.close();
		assert.equal(await remainsPending(closing), true); assert.equal(f.calls.cleanup, 0); release.resolve();
		assert.equal((await outcome).error, reason.proxy); await closing; assert.equal(deliveries, 0);
		assert.ok(scopes.every(bytes => bytes.every(value => value === 0))); assert.ok(f.borrowed.every(frame => frame.pixels.every(value => value === 0)));
		assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
	} finally { release.resolve(); await Promise.allSettled(work.value ? [work.value] : []); await f.close(); }
});

test('Photo runtime3 and authenticated Current original retain opaque consumer failure while native backing shadows stay inert', async () => {
	const recipe = { ...develop([repair(4)]), effects: [invert()], masks: [gradientGraph()], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	const f = fixture([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255], recipe), actualBackings: Uint8Array[] = [];
	const reason = Proxy.revocable({}, {}); reason.revoke(); let getters = 0;
	try {
		const runtime = createPhotoDevelopRenderRuntimeV3();
		const work = f.read(frame => runtime.withFullResolution({ frame, develop: applyPhotoCommandCurrentV1(f.seed.photo, { type: 'set-develop', develop: recipe }).versions[0]!.develop,
			signal: f.lifetime.signal, maskOverlay: { maskId: 'mask', effectId: 'invert' } }, view => {
			assert.ok(view.maskOverlay);
			for (const bytes of [view.frame.pixels, view.maskOverlay.coverage]) {
				actualBackings.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
				for (const key of ['buffer', 'fill', 'byteLength']) Object.defineProperty(bytes, key, { get() { getters++; throw Error('Borrower shadow inspected'); } });
			}
			throw reason.proxy;
		}));
		const result = await work.then(() => ({ error: undefined }), (error: unknown) => ({ error }));
		assert.equal(result.error, reason.proxy); assert.equal(getters, 0); assert.equal(actualBackings.length, 2);
		assert.ok(actualBackings.every(bytes => bytes.every(value => value === 0))); assert.ok(f.borrowed[0]?.pixels.every(value => value === 0));
		assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
	} finally { await f.close(); }
});

test('Photo Current original corruption and strict V2 repair admission refuse before renderer/resource delivery', async () => {
	const recipe = develop([repair(3)]), f = fixture([255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255], recipe); let renders = 0, reflections = 0;
	try {
		const corrupt = f.bytes.slice(); corrupt[corrupt.length - 1] ^= 1; f.hooks.body = new Blob([corrupt]);
		await assert.rejects(f.read(() => { renders++; }), /SHA|digest/iu); assert.equal(f.calls.opens, 0);
		f.hooks.body = f.seed.original;
		await assert.rejects(f.read(() => { renders++; f.changeRevision(); }), { code: 'PHOTO_REVISION_CONFLICT' });
		const raw = new Proxy({}, { ownKeys() { reflections++; throw Error('Old renderer inspected repair pixels'); } });
		await assert.rejects(Reflect.apply(createPhotoDevelopRenderRuntimeV2().withFullResolution, undefined, [{ frame: raw, develop: recipe, signal: f.lifetime.signal }, () => undefined]));
		assert.equal(reflections, 0); assert.equal(renders, 1); assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
	} finally { await f.close(); }
});
