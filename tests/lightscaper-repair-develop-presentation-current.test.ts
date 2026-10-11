/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { PhotoLibraryDevelopPresentationCurrentV1, preparePhotoDevelopPresentationViewCurrentV1,
	type PhotoDevelopPresentationViewCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import { preparePhotoDevelopPresentationViewV2 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v2.ts';
import { withPhotoDevelopDisplayFrameV1 } from '../src/common/editor/imaging/photo-develop-display-frame-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-current-v1.ts';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { applyPhotoCommandCurrentV1 } from '../src/lightscaper/controller/photo-commands-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV3 } from '../src/common/editor/photo-library-develop-proxy-port-v3.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { pngChunk } from './helpers/image-metadata-fixtures.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { gradientGraph, rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

function clone(width: number) { return { id: 'spot', mode: 'clone' as const, enabled: true, target: { x: 1.5 / width, y: .5 },
	source: { x: .5 / width, y: .5 }, radius: .1, feather: 0, opacity: 1 }; }
function recipe(width: number) { return replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [clone(width)] }); }
const targets = () => ({ before: {} as HTMLCanvasElement, after: {} as HTMLCanvasElement, overlay: {} as HTMLCanvasElement });
function original(pixels: readonly number[], develop: unknown, height = 1) {
	const width = pixels.length / (height * 4), header = new Uint8Array(13), view = new DataView(header.buffer), rows = new Uint8Array(pixels.length + height);
	view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6], 8);
	for (let y = 0; y < height; y++) rows.set(pixels.slice(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
	const bytes = new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', new Uint8Array(deflateSync(rows))), pngChunk('IEND', new Uint8Array())]));
	const seed = photoArchiveFixture(1, bytes), photo = applyPhotoCommandCurrentV1(normalizePhotoDocumentCurrentV1({ ...seed.photo, original: { ...seed.photo.original, width, height } }), { type: 'set-develop', develop });
	const lifetime = new PhotoLibrarySessionLifetime(), borrowed: PixelFrameV1['pixels'][] = [], calls = { originals: 0, decoderClosed: 0 };
	const port = createPhotoLibraryDevelopOriginalSessionCurrentV1({ repository: { loadPhoto: async () => photo }, ready: async () => photo.catalogId,
		operation: (run, signal) => lifetime.operation(run, signal), loadOriginal: async () => { calls.originals++; return seed.original; },
		withFrame: (value, consume) => withPhotoOriginalFrameV1(value, async frame => { borrowed.push(frame.pixels); return consume(frame, { orientation: 1, runtimeVersion: 'qualified-fixture' }); },
			{ openImage: async request => {
				const chunks: Uint8Array[] = [];
				for (let offset = 8; offset < request.bytes.length;) { const size = new DataView(request.bytes.buffer, request.bytes.byteOffset + offset, 4).getUint32(0);
					if (String.fromCharCode(...request.bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(request.bytes.subarray(offset + 8, offset + 8 + size)); offset += size + 12; }
				const inflated = inflateSync(Buffer.concat(chunks)), decoded = new Uint8Array(width * height * 4);
				for (let y = 0; y < height; y++) { const row = y * (width * 4 + 1); assert.equal(inflated[row], 0); decoded.set(inflated.subarray(row + 1, row + 1 + width * 4), y * width * 4); }
				return { metadata: { width, height, frameCount: 1, topology: 'single', runtimeVersion: 'qualified-fixture' },
					decodeFrame: async () => ({ rgba: decoded, durationMicroseconds: null }), close() { calls.decoderClosed++; } };
			} }),
	});
	return { port, photo, seed, bytes, calls, borrowed, close: () => lifetime.close(async () => undefined) };
}
function request(f: ReturnType<typeof original>, target: ReturnType<typeof targets>, resolution: 'proxy' | 'full' = 'proxy'): PhotoDevelopPresentationViewCurrentV1 {
	return { photoId: f.photo.id, revision: f.photo.revision, develop: f.photo.versions[0]!.develop, resolution, before: target.before, after: target.after };
}
async function entered(work: Promise<unknown>, marker: Promise<void>) {
	await Promise.race([marker, work.then(() => { assert.fail('Presentation settled before its native borrow entered.'); }, (error: unknown) => { throw error; })]);
}

test('Current proxy authenticates a larger-than-2048 Original and repairs full donor pixels before fitting only displayed frames', async () => {
	const pixels = Array.from({ length: 2050 }, (_, index) => index === 0 ? [255, 0, 0, 255] : index === 1 ? [0, 0, 255, 255] : [0, 0, 0, 255]).flat();
	const f = original(pixels, recipe(2050)), target = targets(), painted = new Map<HTMLCanvasElement, number[]>(), runtime = createPhotoDevelopRenderRuntimeV3();
	let cached = 0, full = 0; const observed: PhotoLibraryDevelopProxyRuntimeV3 = { withProxy() { assert.fail('A proxy donor was used'); },
		withFullResolution(value, consume) { full++; assert.equal(value.frame.descriptor.width, 2050); return runtime.withFullResolution(value, consume); } };
	const owner = new PhotoLibraryDevelopPresentationCurrentV1({ withOriginalFrame: (value, consume, options) => f.port.withFrame(value, consume, options),
		readPreview: async () => { cached++; return { outcome: 'missing' }; }, loadProxy: async () => observed,
		paint(canvas, frame) { painted.set(canvas, [...frame.pixels]); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; }, clear() {} });
	try {
		owner.setView(request(f, target)); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
		assert.deepEqual(owner.snapshot().extent, { before: { width: 2048, height: 1 }, after: { width: 2048, height: 1 } });
		assert.deepEqual(painted.get(target.before)?.slice(0, 12), [255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]);
		assert.deepEqual(painted.get(target.after)?.slice(0, 12), [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
		assert.equal(cached, 0); assert.equal(full, 1); assert.equal(f.calls.originals, 1); assert.equal(f.calls.decoderClosed, 1);
		assert.ok(f.borrowed.every(value => value.every(byte => byte === 0))); assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
	} finally { await owner.close(); await f.close(); }
});

test('Current Before is authenticated immutable Original while genuine Heal and moved source use full dimensions in both display resolutions', async () => {
	const pixels = Array.from({ length: 33 }, (_, index) => { const x = index % 11, gray = x < 3 ? 32 : x >= 4 && x < 7 ? 64 : x >= 8 ? 128 : 0; return [gray, gray, gray, 255]; }).flat();
	pixels.splice(12 * 4, 4, 64, 64, 64, 255); pixels.splice(16 * 4, 4, 192, 192, 192, 255); pixels.splice(20 * 4, 4, 0, 0, 0, 255);
	for (const [sourceX, expected] of [[1.5 / 11, 138], [5.5 / 11, 217]] as const) for (const resolution of ['proxy', 'full'] as const) {
		const state = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [{ ...clone(11), mode: 'heal', target: { x: 9.5 / 11, y: .5 }, source: { x: sourceX, y: .5 }, radius: .2 }] });
		const f = original(pixels, state, 3), target = targets(), painted = new Map<HTMLCanvasElement, number[]>();
		const owner = new PhotoLibraryDevelopPresentationCurrentV1({ withOriginalFrame: (value, consume, options) => f.port.withFrame(value, consume, options), loadProxy: async () => createPhotoDevelopRenderRuntimeV3(),
			paint(canvas, frame) { painted.set(canvas, [...frame.pixels]); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; }, clear() {} });
		try { owner.setView(request(f, target, resolution)); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
			const after = [...pixels]; after.splice(20 * 4, 4, expected, expected, expected, 255); assert.deepEqual(painted.get(target.after), after); assert.deepEqual(painted.get(target.before), pixels);
		} finally { await owner.close(); await f.close(); }
	}
});

test('Current projected observed overlay shares After extent and independent byte-quantized pixels rather than displayed donor coordinates', async () => {
	const invert = createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	const state = { ...recipe(4), effects: [createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: .5 } }), invert,
		createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } })], masks: [gradientGraph()], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	const f = original([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255], state), target = targets(), painted = new Map<HTMLCanvasElement, number[]>();
	const owner = new PhotoLibraryDevelopPresentationCurrentV1({ withOriginalFrame: (value, consume, options) => f.port.withFrame(value, consume, options), loadProxy: async () => createPhotoDevelopRenderRuntimeV3(),
		paint(canvas, frame) { painted.set(canvas, [...frame.pixels]); return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; }, clear() {} });
	try { owner.setView({ ...request(f, target), maskOverlay: { maskId: 'mask', effectId: 'invert' }, maskOverlayMode: 'grayscale', overlay: target.overlay }); await owner.drain();
		assert.deepEqual(painted.get(target.after), [137, 137, 137, 255, 224, 224, 224, 255]);
		assert.deepEqual(painted.get(target.overlay), [191, 191, 191, 255, 64, 64, 64, 255]); assert.equal(owner.snapshot().status, 'ready');
	} finally { await owner.close(); await f.close(); }
});

test('replacement and Close join real Original and held brush retirement before clearing or reacquiring; exact cancellation is suppressed alone', async () => {
	const asset = await withPreparedBrushMaskResourceV1({ width: 1, height: 1, alpha: Uint8Array.of(255) }, value => ({ reference: value.reference, bytes: value.bytes.slice() }));
	const invert = createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } });
	const state = { ...recipe(2), effects: [invert], masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [{ name: 'alpha', kind: 'alpha', sourceRef: asset.reference.storageKey }], nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'alpha' }], outputNodeId: 'alpha' }], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	const f = original([255, 255, 255, 255, 0, 0, 0, 255], state), target = targets(), marker = deferred<void>(), release = deferred<void>(), backings: Uint8Array[] = [], calls = { source: 0, paints: 0 };
	const runtime = createPhotoDevelopRenderRuntimeV3({ maskSource: { async withBytes(_reference, consume) { calls.source++; const bytes = asset.bytes.slice(); backings.push(bytes);
		try { marker.resolve(); await release.promise; return await consume(bytes); } finally { bytes.fill(0); } } } });
	const owner = new PhotoLibraryDevelopPresentationCurrentV1({ withOriginalFrame: (value, consume, options) => f.port.withFrame(value, consume, options), loadProxy: async () => runtime,
		paint(_canvas, frame) { calls.paints++; return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; }, clear() {} });
	try { owner.setView(request(f, target)); const work = owner.drain(); await entered(work, marker.promise);
		const paused = owner.pause(), closed = owner.close(); assert.equal(await remainsPending(closed), true); assert.equal(f.calls.decoderClosed, 1);
		release.resolve(); await work; await paused; await closed; assert.equal(calls.source, 1); assert.equal(calls.paints, 1);
		assert.ok(backings.every(bytes => bytes.every(value => value === 0))); assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0)));
		assert.deepEqual(new Uint8Array(await f.seed.original.arrayBuffer()), f.bytes);
	} finally { release.resolve(); await Promise.allSettled([owner.close()]); await f.close(); }
});

test('Current request capture is complete before lazy barriers, and permanently strict V2 refuses process3', () => {
	const target = targets(), mutable = recipe(2), view = { photoId: 'photo', revision: 7, develop: mutable, before: target.before, after: target.after };
	const prepared = preparePhotoDevelopPresentationViewCurrentV1(view); Reflect.set(view, 'revision', 8);
	assert.equal(prepared.revision, 7); assert.equal(prepared.develop.processVersion, 3); assert.throws(() => preparePhotoDevelopPresentationViewV2(view));
	let traps = 0;
	for (const invalid of [{ ...view, revision: undefined }, { ...view, before: target.after }, { ...view, extra: true },
		{ ...view, get develop() { traps++; return mutable; } }]) assert.throws(() => preparePhotoDevelopPresentationViewCurrentV1(invalid));
	assert.equal(traps, 0);
});

test('fitted display lifetime preserves opaque primary and pinned physical wipes even when paint shadows byte geometry', async () => {
	const input = rgbaFrame([255, 0, 0, 255, 0, 0, 255, 255]), before = input.pixels.slice(), reason = Proxy.revocable({}, {}); reason.revoke();
	let shadows = 0, backing: Uint8Array | undefined;
	const result = await withPhotoDevelopDisplayFrameV1({ frame: input }, value => {
		backing = new Uint8Array(value.frame.pixels.buffer, value.frame.pixels.byteOffset, value.frame.pixels.byteLength);
		for (const key of ['buffer', 'fill', 'byteLength']) Object.defineProperty(value.frame.pixels, key, { get() { shadows++; throw Error('Display cleanup inspected shadow'); } });
		throw reason.proxy;
	}, 'proxy').then(() => ({ success: true }), (error: unknown) => ({ error }));
	assert.ok('error' in result); assert.equal(Object.is(result.error, reason.proxy), true); assert.equal(shadows, 0); assert.ok(backing?.every(byte => byte === 0)); assert.deepEqual(input.pixels, before);
});

test('display fitting refuses oversized full frames before pixel authority and transferred display output cannot certify cleanup', async () => {
	let reads = 0; const hostile = new Proxy({}, { ownKeys() { reads++; throw Error('Pixel authority'); }, get() { reads++; throw Error('Pixel read'); } });
	await assert.rejects(withPhotoDevelopDisplayFrameV1({ frame: { descriptor: { ...rgbaFrame([0, 0, 0, 255]).descriptor, width: 16385 }, pixels: hostile } }, () => undefined, 'full'), /limit|ceiling|side|budget/u); assert.equal(reads, 0);
	await assert.rejects(withPhotoDevelopDisplayFrameV1({ frame: rgbaFrame([0, 0, 0, 255]) }, value => {
		structuredClone(value.frame.pixels.buffer, { transfer: [value.frame.pixels.buffer] });
	}, 'proxy'), /detach|wipe|retirement/u);
});
