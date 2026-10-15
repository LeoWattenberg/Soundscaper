/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { PhotoLibraryDevelopPresentationCurrentV1, type PhotoDevelopPresentationPortsCurrentV1 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-current-v1.ts';
import type { PhotoLibraryDevelopProxyRuntimeV3 } from '../src/common/editor/photo-library-develop-proxy-port-v3.ts';
import type { PhotoLibraryDevelopOriginalReadV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { compilePinnedLibRawModuleV1 } from '../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { withDecodedRawOriginalV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionCurrentV1 } from '../src/lightscaper/controller/photo-library-develop-original-session-current-v1.ts';
import { PhotoLibrarySessionLifetime } from '../src/lightscaper/controller/photo-library-session-lifetime.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { applyPhotoCommandCurrentV1 } from '../src/lightscaper/controller/photo-commands-current-v1.ts';
import { withPhotoOriginalFrameV1 } from '../src/lightscaper/preview/photo-original-frame-v1.ts';
import { withPhotoOriginalFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { pngChunk } from './helpers/image-metadata-fixtures.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const OPTIONS = { concurrency: false, timeout: 20_000 };
let compiled: Promise<WebAssembly.Module> | undefined;
function moduleBytes(): Promise<WebAssembly.Module> {
	compiled ??= readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url))
		.then(bytes => compilePinnedLibRawModuleV1(new Uint8Array(bytes))); return compiled;
}
function recipe() { return normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] } }); }
function png() {
	const width = 4096, height = 1, header = new Uint8Array(13), rows = new Uint8Array(width * 4 + 1), view = new DataView(header.buffer);
	view.setUint32(0, width); view.setUint32(4, height); header.set([8, 6], 8);
	for (let x = 0; x < width; x++) rows.set([x % 251, (x + 1) % 251, (x + 2) % 251, 255], 1 + x * 4);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
		pngChunk('IDAT', new Uint8Array(deflateSync(rows))), pngChunk('IEND', new Uint8Array())]));
}

/** Both routes use the genuine Current selected-Original owner and retained
 * byte SHA/revision checks. Only the byte branch's browser PNG entropy boundary
 * is modeled using actual zlib data; native words use the production WASM worker. */
async function fixture(kind: 'byte' | 'word') {
	const bytes = kind === 'byte' ? png() : rawDngFixtureV1(6).bytes, width = kind === 'byte' ? 4096 : 32, height = kind === 'byte' ? 1 : 32;
	const seed = photoArchiveFixture(1, bytes);
	let photo = applyPhotoCommandCurrentV1(normalizePhotoDocumentCurrentV1({ ...seed.photo, metadata: { ...seed.photo.metadata, orientation: kind === 'word' ? 6 : 1 }, original: { ...seed.photo.original, width, height,
		mimeType: kind === 'byte' ? 'image/png' : 'image/x-adobe-dng' } }), { type: 'set-develop', develop: recipe() });
	const originalPhoto = photo, lifetime = new PhotoLibrarySessionLifetime(), workers = kind === 'word' ? await rawWorkerFixtureV1() : undefined;
	const frames: PixelFrameV1[] = [], requests: PhotoLibraryDevelopOriginalReadV1[] = [];
	const calls = { originals: 0, cached: 0, proxy: 0, full: 0, active: 0, maximumActive: 0, clears: 0 };
	const hooks = { beforeRetire: async (): Promise<void> => undefined };
	const borrow: typeof withPhotoOriginalFrameCurrentV1 = (value, consume) => {
		const scope: typeof consume = async (frame, provenance) => {
			frames.push(frame); calls.active++; calls.maximumActive = Math.max(calls.maximumActive, calls.active);
			try { const result = await consume(frame, provenance); await hooks.beforeRetire(); return result; }
			finally { calls.active--; }
		};
		if (kind === 'word') return withPhotoOriginalFrameCurrentV1(value, scope, {
			withRawFrame: (request, accept) => withDecodedRawOriginalV1(request, accept, { loadModule: moduleBytes, createWorker: workers!.createWorker }),
		});
		return withPhotoOriginalFrameV1(value, scope, { openImage: async request => {
			const chunks: Uint8Array[] = [];
			for (let offset = 8; offset < request.bytes.length;) {
				const length = new DataView(request.bytes.buffer, request.bytes.byteOffset + offset, 4).getUint32(0);
				if (String.fromCharCode(...request.bytes.subarray(offset + 4, offset + 8)) === 'IDAT') chunks.push(request.bytes.subarray(offset + 8, offset + 8 + length));
				offset += length + 12;
			}
			const data = inflateSync(Buffer.concat(chunks)); assert.equal(data[0], 0); const rgba = new Uint8Array(data.subarray(1));
			return { metadata: { width, height, frameCount: 1, topology: 'single', runtimeVersion: 'explicit-png-zlib-boundary' },
				async decodeFrame() { return { rgba, durationMicroseconds: null }; }, close() { rgba.fill(0); } };
		} });
	};
	const port = createPhotoLibraryDevelopOriginalSessionCurrentV1({ repository: { loadPhoto: async () => photo }, ready: async () => photo.catalogId,
		operation: (run, signal) => lifetime.operation(run, signal), loadOriginal: async () => { calls.originals++; return seed.original; }, withFrame: borrow });
	const actual = createPhotoDevelopRenderRuntimeCurrentV1();
	const runtime: PhotoLibraryDevelopProxyRuntimeV3 = {
		withProxy(value, consume) {
			assert.equal(this, runtime); calls.proxy++; assert.deepEqual([value.frame.descriptor.width, value.frame.descriptor.height], [width, height]);
			assert.equal(value.frame.descriptor.sampleFormat, kind === 'byte' ? 'unorm8' : 'unorm16'); return actual.withProxy(value, consume);
		},
		withFullResolution(value, consume) {
			assert.equal(this, runtime); calls.full++; assert.deepEqual([value.frame.descriptor.width, value.frame.descriptor.height], [width, height]);
			return actual.withFullResolution(value, consume);
		},
	};
	const before = {} as HTMLCanvasElement, after = {} as HTMLCanvasElement;
	const painted = new Map<HTMLCanvasElement, Readonly<{ width: number; height: number; pixels: readonly number[] }>>();
	const ports: PhotoDevelopPresentationPortsCurrentV1 = {
		withOriginalFrame: function<Value>(this: PhotoDevelopPresentationPortsCurrentV1, bound: PhotoLibraryDevelopOriginalReadV1,
			consume: Parameters<typeof port.withFrame<Value>>[1], options?: Readonly<{ signal?: AbortSignal }>) {
			assert.equal(this, ports); requests.push(bound); assert.equal(bound.photoId, originalPhoto.id); assert.equal(bound.expectedRevision, originalPhoto.revision);
			return port.withFrame(bound, consume, options);
		},
		async readPreview() { calls.cached++; assert.fail('A cached or camera culling image cannot supply Current Develop.'); },
		async loadProxy() { assert.equal(this, ports); return runtime; },
		paint(canvas: HTMLCanvasElement, frame: PixelFrameV1) {
			assert.equal(this, ports); assert.equal(frame.descriptor.sampleFormat, 'unorm8'); assert.equal(frame.descriptor.transfer, 'srgb');
			painted.set(canvas, { width: frame.descriptor.width, height: frame.descriptor.height, pixels: [...frame.pixels] });
			return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength };
		},
		clear(canvas: HTMLCanvasElement) { assert.equal(this, ports); calls.clears++; painted.delete(canvas); },
	};
	return { port, ports, before, after, painted, frames, requests, calls, hooks, workers, originalPhoto, bytes,
		view: (resolution: 'proxy' | 'full' = 'proxy') => ({ photoId: originalPhoto.id, revision: originalPhoto.revision, develop: recipe(), resolution, before, after }),
		makeStale() { photo = normalizePhotoDocumentCurrentV1({ ...photo, revision: photo.revision + 1 }); },
		async verifyOriginal() { assert.deepEqual(new Uint8Array(await seed.original.arrayBuffer()), bytes); assert.deepEqual(photo.original, originalPhoto.original); },
		async close() { try { await lifetime.close(async () => undefined); } finally { await workers?.close(); } },
	};
}
async function reached(work: Promise<unknown>, entered: Promise<void>) {
	await Promise.race([entered, work.then(() => assert.fail('Presentation settled before its actual Original retirement.'), (error: unknown) => { throw error; })]);
}

for (const kind of ['byte', 'word'] as const) test(`Current ${kind} presentation chooses real proxy versus full runtime while retaining the authenticated full Original`, OPTIONS, async () => {
	const f = await fixture(kind), owner = new PhotoLibraryDevelopPresentationCurrentV1(f.ports);
	try {
		owner.setView(f.view('proxy')); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
		assert.deepEqual([f.calls.proxy, f.calls.full, f.calls.cached], [1, 0, 0]); assert.equal(f.calls.originals, 1);
		const width = kind === 'byte' ? 2048 : 32, height = kind === 'byte' ? 1 : 32;
		assert.deepEqual(owner.snapshot().extent, { before: { width, height }, after: { width, height } });
		assert.equal(owner.snapshot().before?.sampledPixels, width * height); assert.equal(owner.snapshot().after?.sampledPixels, width * height);
		assert.deepEqual(f.painted.get(f.before), f.painted.get(f.after));
		if (kind === 'byte') assert.deepEqual(f.painted.get(f.after)?.pixels.slice(0, 12), [0, 1, 2, 255, 2, 3, 4, 255, 4, 5, 6, 255]);
		assert.ok(f.frames.every(frame => frame.pixels.every(sample => sample === 0))); assert.equal(f.calls.active, 0);
		owner.setView(f.view('full')); await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
		assert.deepEqual([f.calls.proxy, f.calls.full, f.calls.cached], [1, 1, 0]); assert.equal(f.calls.originals, 2);
		const fullWidth = kind === 'byte' ? 4096 : 32;
		assert.deepEqual(owner.snapshot().extent, { before: { width: fullWidth, height }, after: { width: fullWidth, height } });
		assert.equal(owner.snapshot().before?.sampledPixels, fullWidth * height); assert.equal(owner.snapshot().after?.sampledPixels, fullWidth * height);
		assert.deepEqual(f.painted.get(f.before), f.painted.get(f.after));
		assert.ok(f.frames.every(frame => frame.pixels.every(sample => sample === 0))); assert.equal(f.calls.maximumActive, 1);
		if (f.workers) { assert.equal(f.workers.active(), 0); assert.equal(f.workers.statistics.joined, 2); }
		await f.verifyOriginal();
	} finally { await owner.close(); await f.close(); }
});

test('Switching Current proxy to full joins held Original retirement before opening the replacement source', OPTIONS, async () => {
	const f = await fixture('byte'), owner = new PhotoLibraryDevelopPresentationCurrentV1(f.ports), entered = deferred<void>(), release = deferred<void>();
	let held = false; f.hooks.beforeRetire = async () => { if (!held) { held = true; entered.resolve(); await release.promise; } };
	try {
		owner.setView(f.view('proxy')); const first = owner.drain(); await reached(first, entered.promise);
		assert.equal(owner.snapshot().status, 'pending'); assert.equal(f.calls.proxy, 1); assert.equal(f.calls.active, 1);
		assert.ok(f.frames[0]?.pixels.some(sample => sample !== 0)); owner.setView(f.view('full'));
		assert.equal(f.calls.full, 0); assert.equal(f.calls.originals, 1); assert.equal(f.painted.size, 0);
		release.resolve(); await first; await owner.drain(); assert.equal(owner.snapshot().status, 'ready');
		assert.deepEqual([f.calls.proxy, f.calls.full, f.calls.originals, f.calls.maximumActive], [1, 1, 2, 1]);
		assert.ok(f.frames.every(frame => frame.pixels.every(sample => sample === 0))); await f.verifyOriginal();
	} finally { release.resolve(); await Promise.allSettled([owner.close(), f.close()]); }
});

test('Close during native Current proxy retirement joins the real worker-backed Original and clears painted canvases', OPTIONS, async () => {
	const f = await fixture('word'), owner = new PhotoLibraryDevelopPresentationCurrentV1(f.ports), entered = deferred<void>(), release = deferred<void>();
	const states: string[] = [], unsubscribe = owner.subscribe(value => { states.push(value.status); });
	f.hooks.beforeRetire = async () => { entered.resolve(); await release.promise; };
	try {
		owner.setView(f.view('proxy')); const work = owner.drain(); await reached(work, entered.promise);
		assert.equal(f.calls.proxy, 1); assert.equal(f.calls.full, 0); assert.equal(f.workers?.active(), 0); assert.equal(f.workers?.statistics.joined, 1);
		const closing = owner.close(); assert.equal(await remainsPending(closing), true); assert.equal(f.calls.active, 1);
		assert.ok(f.frames[0]?.pixels.some(sample => sample !== 0)); release.resolve(); await work; await closing;
		assert.equal(f.calls.active, 0); assert.equal(f.painted.size, 0); assert.equal(states.includes('ready'), false);
		assert.ok(f.frames.every(frame => frame.pixels.every(sample => sample === 0))); await f.verifyOriginal();
	} finally { release.resolve(); unsubscribe(); await Promise.allSettled([owner.close(), f.close()]); }
});

test('A revision change after proxy paint refuses ready publication and retires every original-bound target', OPTIONS, async () => {
	const f = await fixture('byte'), owner = new PhotoLibraryDevelopPresentationCurrentV1(f.ports), entered = deferred<void>(), release = deferred<void>();
	f.hooks.beforeRetire = async () => { entered.resolve(); await release.promise; };
	try {
		owner.setView(f.view('proxy')); const work = owner.drain(); await reached(work, entered.promise);
		assert.equal(f.calls.proxy, 1); f.makeStale(); release.resolve(); await work;
		assert.equal(owner.snapshot().status, 'failed'); assert.equal(f.painted.size, 0); assert.equal(f.calls.active, 0);
		assert.ok(f.frames.every(frame => frame.pixels.every(sample => sample === 0))); await f.verifyOriginal();
	} finally { release.resolve(); await Promise.allSettled([owner.close(), f.close()]); }
});
