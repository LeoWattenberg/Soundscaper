/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { staticRelativeDependencies, EAGER_CHUNK_GROUPS } from './helpers/eager-chunk-group-crossings.ts';
import { importFramescaperTimelineImagesTimelineImage as importImages,
	type FramescaperTimelineImagePublicationRequestTimelineImage } from '../src/framescaper/editor-image-import-coordinator-timeline-image.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { normalizeFramescaperImageSourceV1 } from '../src/common/editor/timeline-image-model.ts';
import { openFramescaperImageFramePackV1 } from '../src/common/editor/timeline-image-frame-pack-v1.ts';
import { prepareFramescaperHdrMergeCanonicalSourceCurrentV1, withFramescaperHdrMergeCanonicalSourceCurrentV1 } from '../src/framescaper/internal/image-hdr-merge-frame-source-current-v1.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { pngChunk } from './helpers/image-metadata-fixtures.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const DECODERS = ['timeline-image-browser-native-port.ts', 'timeline-image-native-decode-v1.ts'] as const;
const PIXELS = [64, 128, 192, 255, 200, 48, 16, 255] as const;
const COORDINATOR = new URL('../src/framescaper/editor-image-import-coordinator-timeline-image.ts', import.meta.url);

test('Frame image-import composition has no eager value dependency on either native raster decoder owner', () => {
	const source = transformSync(readFileSync(COORDINATOR, 'utf8'), { loader: 'ts', format: 'esm' }).code;
	const imports = staticRelativeDependencies(source);
	for (const name of DECODERS) assert.ok(!imports.includes('../common/editor/' + name), `${name} must open only for an actual admitted image import.`);
});

test('the exact two native raster decoder leaves share existing optional file admission ownership', () => {
	const owner = 'editor-image-file-admission';
	for (const name of DECODERS) {
		const path = new URL('../src/common/editor/' + name, import.meta.url).pathname;
		for (const spelling of [path, path.replaceAll('/', '\\')]) assert.equal(chunkGroupForModulePath(spelling), owner, spelling);
		assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
		assert.notEqual(chunkGroupForModulePath(path.replace('.ts', '-future.ts')), owner);
		assert.notEqual(chunkGroupForModulePath(path.replace('/editor/', '/editor/foreign/')), owner);
	}
	const group = chunkGroups.find(value => value.name === owner); assert.ok(group);
	assert.equal(group.priority, 99); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
	assert.equal(group.includeDependenciesRecursively, false); assert.equal(EAGER_CHUNK_GROUPS.has(owner), false);
});

function originalPng(): Uint8Array<ArrayBuffer> {
	const header = new Uint8Array(13), view = new DataView(header.buffer); view.setUint32(0, 2); view.setUint32(4, 1); header.set([8, 6], 8);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
		pngChunk('IDAT', new Uint8Array(deflateSync(Uint8Array.of(0, ...PIXELS)))), pngChunk('IEND', new Uint8Array())]));
}

/** The browser Bitmap/Canvas boundary is modeled; production defaultDecode,
 * its decoder routing, timing, FramePack bytes and native HDR source borrow all
 * execute unchanged. This Node fixture does not claim browser codec pixels. */
function bitmapBoundary(beforeReturn?: () => Promise<void>) {
	const keys = ['ImageDecoder', 'createImageBitmap', 'OffscreenCanvas'] as const;
	const saved = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
	const planes = new WeakMap<object, Uint8Array<ArrayBuffer>>(), bodies: Uint8Array<ArrayBuffer>[] = [];
	let opened = 0, closed = 0;
	class Canvas {
		pixels = new Uint8Array(0);
		constructor(readonly width: number, readonly height: number) {}
		getContext() { return {
			clearRect: () => { this.pixels.fill(0); },
			drawImage: (bitmap: object) => { const plane = planes.get(bitmap); assert.ok(plane); this.pixels = new Uint8Array(plane); },
			getImageData: () => ({ data: new Uint8ClampedArray(this.pixels) }),
		}; }
	}
	const open = async (body: Blob, options: unknown) => {
		assert.deepEqual(options, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
		const bytes = new Uint8Array(await Blob.prototype.arrayBuffer.call(body)); bodies.push(bytes);
		const view = new DataView(bytes.buffer), chunks: Uint8Array[] = [];
		assert.equal(view.getUint32(16), 2); assert.equal(view.getUint32(20), 1);
		for (let at = 8; at < bytes.length;) { const length = view.getUint32(at), type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
			if (type === 'IDAT') chunks.push(bytes.subarray(at + 8, at + 8 + length)); at += length + 12; }
		const row = inflateSync(Buffer.concat(chunks)); assert.equal(row[0], 0); assert.equal(row.length, 9);
		const plane = new Uint8Array(row.subarray(1)), bitmap = { width: 2, height: 1, close() { closed++; plane.fill(0); } };
		planes.set(bitmap, plane); opened++; await beforeReturn?.(); return bitmap;
	};
	for (const [index, value] of [undefined, open, Canvas].entries()) Object.defineProperty(globalThis, keys[index]!, { configurable: true, value });
	return { bodies, get opened() { return opened; }, get closed() { return closed; }, restore() {
		for (const [index, key] of keys.entries()) { const descriptor = saved[index];
			if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
	} };
}

function request(bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal) {
	const base = createFramescaperBaselineImageFixture({ imageOnly: true }).project;
	const publications: Readonly<FramescaperTimelineImagePublicationRequestTimelineImage>[] = [];
	let reads = 0, nextId = 0;
	const file = { name: 'HDR canonical bracket.png', type: 'image/png', size: bytes.length,
		async arrayBuffer() { reads++; return new Uint8Array(bytes).buffer; } };
	return { file, publications, get reads() { return reads; }, options: {
		project: base, files: [file], sequenceStartFrame: 0, createId: (prefix: string) => `lazy-${prefix}-${++nextId}`,
		publisher: { async publish(value: FramescaperTimelineImagePublicationRequestTimelineImage) {
			publications.push(value); return applyFramescaperProjectCommand(PROFILE, value.project, value.command, { now: '2026-10-16T16:00:00.000Z' });
		} }, ...(signal ? { signal } : {}),
	} };
}

test('real default import creates an unchanged Source1 Original usable by the actual canonical HDR input owner', async t => {
	const boundary = bitmapBoundary(); t.after(() => boundary.restore());
	const bytes = originalPng(), before = bytes.slice(), f = request(bytes);
	const result = await importImages(f.options);
	assert.equal(result.files[0]?.status, 'imported'); assert.equal(f.reads, 1); assert.equal(boundary.opened, 1); assert.equal(boundary.closed, 1);
	const publication = f.publications[0]; assert.ok(publication);
	const source = normalizeFramescaperImageSourceV1(publication.source), body = new Uint8Array(await publication.body.arrayBuffer());
	assert.equal(source.original.fileName, 'HDR canonical bracket.png'); assert.equal(source.original.mimeType, 'image/png');
	assert.equal(source.original.sha256, createHash('sha256').update(before).digest('hex')); assert.equal(source.original.byteLength, before.length);
	const reader = await openFramescaperImageFramePackV1({ source, read: (offset, length) => body.slice(offset, offset + length) });
	assert.deepEqual(await reader.readOriginal(), before); assert.deepEqual(await reader.readFrame(0), Uint8Array.from(PIXELS));
	assert.deepEqual(reader.receipt.decoder, { id: 'browser-native', version: 'create-image-bitmap-v1' });
	let borrowed: Uint8Array | undefined;
	const plan = prepareFramescaperHdrMergeCanonicalSourceCurrentV1(source);
	await withFramescaperHdrMergeCanonicalSourceCurrentV1(plan, { loadMediaAsset: async () => publication.body }, frame => {
		assert.equal(frame.descriptor.sampleFormat, 'unorm8'); assert.equal(frame.descriptor.transfer, 'srgb');
		assert.ok(frame.pixels instanceof Uint8Array); borrowed = frame.pixels; assert.deepEqual([...frame.pixels], PIXELS);
	}, { assertCurrent() {} });
	assert.ok(borrowed); assert.ok(borrowed.every(value => value === 0), 'The canonical consumer borrow must be physically retired.');
	assert.deepEqual(boundary.bodies, [before]); assert.deepEqual(bytes, before);
});

test('pre-aborted default image import performs no Original read, browser decode or publication', async t => {
	const boundary = bitmapBoundary(); t.after(() => boundary.restore());
	const bytes = originalPng(), before = bytes.slice(), stop = new AbortController(); stop.abort(Object.freeze({ cancelled: 'before import' }));
	const f = request(bytes, stop.signal), result = await importImages(f.options);
	assert.equal(result.files[0]?.status, 'cancelled'); assert.equal(f.reads, 0); assert.equal(boundary.opened, 0); assert.equal(f.publications.length, 0);
	assert.deepEqual(bytes, before);
});

test('cancellation joins a held native bitmap result and closes it before refusing publication', async t => {
	const entered = deferred<void>(), release = deferred<void>(), boundary = bitmapBoundary(async () => { entered.resolve(); await release.promise; });
	t.after(() => boundary.restore());
	const bytes = originalPng(), before = bytes.slice(), stop = new AbortController(), f = request(bytes, stop.signal), work = importImages(f.options);
	try {
		await entered.promise; stop.abort(Object.freeze({ cancelled: 'held browser result' }));
		assert.equal(await remainsPending(work), true); assert.equal(boundary.closed, 0); assert.equal(f.publications.length, 0);
		release.resolve(); const result = await work;
		assert.equal(result.files[0]?.status, 'cancelled'); assert.equal(boundary.closed, 1); assert.equal(f.publications.length, 0);
		assert.deepEqual(bytes, before);
	} finally { release.resolve(); await Promise.allSettled([work]); }
});
