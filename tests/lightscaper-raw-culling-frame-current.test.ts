/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { withPhotoCullingFrameCurrentV1, type PhotoCullingFramePortsCurrentV1 } from '../src/lightscaper/preview/photo-culling-frame-current-v1.ts';
import { withPhotoPreviewOriginalFrameCurrentV1 } from '../src/lightscaper/preview/photo-original-frame-current-v1.ts';
import type { PhotoPreviewOriginalBindingV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { compilePinnedLibRawModuleV1 } from '../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { withDecodedRawOriginalV1, withRawEmbeddedPreviewV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { OpenFramescaperBrowserNativeImageV1 } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';

let compiled: Promise<WebAssembly.Module> | undefined;
function moduleBytes(): Promise<WebAssembly.Module> {
	compiled ??= readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url))
		.then(bytes => compilePinnedLibRawModuleV1(new Uint8Array(bytes)));
	return compiled;
}
/** Independent marker walk of the actual embedded payload, separate from the
 * bridge's SOF parser and browser admission. No entropy decode is modeled here. */
function jpegExtent(bytes: Uint8Array): readonly [number, number] {
	assert.deepEqual([...bytes.subarray(0, 2)], [255, 216]);
	for (let offset = 2; offset < bytes.length;) {
		assert.equal(bytes[offset++], 255); while (bytes[offset] === 255) offset++;
		const marker = bytes[offset++]!;
		if (marker === 218 || marker === 217) break;
		if (marker === 1 || marker >= 208 && marker <= 215) continue;
		const length = bytes[offset]! * 256 + bytes[offset + 1]!; assert.ok(length >= 2 && offset + length <= bytes.length);
		if ([192, 193, 194].includes(marker)) {
			assert.equal(bytes[offset + 2], 8);
			return [bytes[offset + 5]! * 256 + bytes[offset + 6]!, bytes[offset + 3]! * 256 + bytes[offset + 4]!];
		}
		offset += length;
	}
	throw new Error('Pinned camera JPEG lacks its actual frame header.');
}
async function qualifyCameraPreview(bytes: Uint8Array): Promise<void> {
	type Call = (...args: number[]) => number;
	type Api = WebAssembly.Exports & { memory: WebAssembly.Memory; _initialize: Call; raw_input_alloc: Call; raw_open: Call;
		raw_preview: Call; raw_preview_type: Call; raw_preview_ptr: Call; raw_preview_bytes: Call; raw_preview_width: Call; raw_preview_height: Call; raw_destroy: Call };
	const native = new WebAssembly.Instance(await moduleBytes(), { env: { emscripten_notify_memory_growth() {} },
		wasi_snapshot_preview1: { fd_read: () => 8, fd_write: () => 8, fd_close: () => 8, fd_seek: () => 8 } });
	const api = native.exports as Api;
	try {
		api._initialize(); const pointer = api.raw_input_alloc(bytes.length); assert.ok(pointer > 0);
		new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes); assert.equal(api.raw_open(), 0); assert.equal(api.raw_preview(), 0);
		assert.equal(api.raw_preview_type(), 1);
		const encoded = new Uint8Array(api.memory.buffer, api.raw_preview_ptr(), api.raw_preview_bytes());
		// This exact pinned file carries a 2048×1360 camera JPEG, independently
		// observed through its compressed SOF and the standalone native C ABI.
		assert.deepEqual(jpegExtent(encoded), [2048, 1360]);
		assert.deepEqual([api.raw_preview_width(), api.raw_preview_height()], [2048, 1360]);
	} finally { try { api.raw_destroy(); } finally { new Uint8Array(api.memory.buffer).fill(0); } }
}
function request(bytes: Uint8Array<ArrayBuffer>, width = 32, height = 32) {
	const binding: PhotoPreviewOriginalBindingV1 = { catalogId: 'culling-catalog', photoId: 'culling-photo', originalId: 'culling-original',
		storageKey: 'culling-body', contentSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length, width, height };
	return { binding, body: new Blob([bytes]), source: 'camera-embedded' as const };
}
function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>(done => { resolve = done; }); return { promise, resolve };
}
function observe<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
const ORDERS = [[], [1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 6, 5], [6, 5, 4, 3, 2, 1], [5, 6, 3, 4, 1, 2],
	[1, 3, 5, 2, 4, 6], [5, 3, 1, 6, 4, 2], [6, 4, 2, 5, 3, 1], [2, 4, 6, 1, 3, 5]] as const;
const FLIPS = [0, 0, 1, 3, 2, 4, 6, 7, 5] as const;
function rgba(labels: readonly number[]): Uint8Array<ArrayBuffer> { return new Uint8Array(labels.flatMap(label => [label, label + 10, label + 20, 255])); }
function frame(labels: readonly number[] = [1]): PixelFrameV1 {
	return { descriptor: { schemaVersion: 1, width: labels.length, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: rgba(labels) };
}
/** Only marker/EXIF structure is modeled here. No Node JPEG entropy decoder is
 * claimed: actual browser codec qualification belongs to the browser witness. */
function jpeg(orientation = 1): Uint8Array<ArrayBuffer> {
	const exif = new Uint8Array(32), view = new DataView(exif.buffer);
	exif.set([69, 120, 105, 102, 0, 0, 73, 73, 42, 0]); view.setUint32(10, 8, true); view.setUint16(14, 1, true);
	view.setUint16(16, 274, true); view.setUint16(18, 3, true); view.setUint32(20, 1, true); view.setUint16(24, orientation, true);
	return new Uint8Array([255, 216, 255, 225, 0, exif.length + 2, ...exif,
		255, 192, 0, 17, 8, 0, 3, 0, 2, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
		255, 218, 0, 12, 3, 1, 0, 2, 0, 3, 0, 0, 63, 0, 0, 255, 217]);
}
function modeledPorts(jpegOrientation = 1, rawOrientation = 1) {
	const compressed = jpeg(jpegOrientation), pixels = rgba(ORDERS[jpegOrientation]!);
	let closed = 0, fallback = 0, preview = 0;
	const ports: PhotoCullingFramePortsCurrentV1 = {
		async withRawPreview(_value, consume) {
			assert.equal(this, ports); preview++;
			try { return await consume({ type: 'jpeg', width: 2, height: 3, channels: 3, bits: 8, rawFlip: FLIPS[rawOrientation]!, bytes: compressed }); }
			finally { compressed.fill(0); }
		},
		async openImage(value) {
			assert.equal(this, ports); assert.equal(value.format, 'jpeg'); assert.equal(value.mimeType, 'image/jpeg');
			const session = { metadata: { width: jpegOrientation >= 5 ? 3 : 2, height: jpegOrientation >= 5 ? 2 : 3,
				frameCount: 1, topology: 'single' as const, runtimeVersion: 'modeled-browser-jpeg-1' },
				async decodeFrame(index: number) { assert.equal(this, session); assert.equal(index, 0); return { rgba: pixels, durationMicroseconds: null }; },
				close() { assert.equal(this, session); closed++; } };
			return session;
		},
		async withOriginalFrame(_value, consume) { assert.equal(this, ports); fallback++; return consume(frame(), { orientation: 1, runtimeVersion: 'fallback-1' }); },
	};
	return { ports, pixels, compressed, closed: () => closed, fallback: () => fallback, preview: () => preview };
}

test('Actual pinned D60 worker extracts camera JPEG at its real extent and retires native work before the modeled browser boundary', async () => {
	const bytes = new Uint8Array(await readFile(new URL('../vendor/lightscaper-raw-fixtures/D60.CRW', import.meta.url)));
	assert.equal(bytes.length, 4_363_206); assert.equal(createHash('sha256').update(bytes).digest('hex'), '168d5d5cad67364a0ee01fa2e0d1847f3ef9c94e5593a4699bb5eb7743fa4be2');
	await qualifyCameraPreview(bytes);
	const workers = await rawWorkerFixtureV1(), before = bytes.slice();
	let compressed: Uint8Array | undefined, decoded: Uint8Array | undefined, output: Uint8Array | undefined, closed = 0;
	const ports: PhotoCullingFramePortsCurrentV1 = {
		withRawPreview(value, consume) {
			assert.equal(this, ports);
			return withRawEmbeddedPreviewV1(value, preview => { assert.equal(workers.active(), 0); assert.equal(workers.statistics.joined, 1);
				assert.ok(preview); assert.equal(preview.type, 'jpeg'); assert.deepEqual([preview.width, preview.height], [2048, 1360]);
				assert.deepEqual(jpegExtent(preview.bytes), [2048, 1360]);
				compressed = preview.bytes; return consume(preview); }, { loadModule: moduleBytes, createWorker: workers.createWorker });
		},
		async openImage(value) {
			assert.equal(this, ports); assert.equal(workers.active(), 0); assert.deepEqual([...value.bytes.subarray(0, 2)], [255, 216]);
			// Explicit model of browser JPEG decode only. The compressed camera
			// payload above came from the actual pinned native worker unchanged.
			decoded = new Uint8Array(2048 * 1360 * 4); decoded.fill(255); decoded[0] = 17;
			return { metadata: { width: 2048, height: 1360, frameCount: 1, topology: 'single', runtimeVersion: 'modeled-browser-jpeg-1' },
				async decodeFrame() { return { rgba: decoded!, durationMicroseconds: null }; }, close() { closed++; } };
		},
		async withOriginalFrame() { assert.fail('A genuine supported JPEG must not demosaic the Original.'); },
	};
	try {
		assert.equal(await withPhotoCullingFrameCurrentV1(request(bytes, 3088, 2056), async (value, provenance) => {
			assert.equal(workers.active(), 0); assert.equal(closed, 1); assert.ok(compressed?.every(byte => byte === 0));
			assert.ok(decoded?.every(byte => byte === 0)); assert.deepEqual(value.descriptor, { schemaVersion: 1, width: 2048, height: 1360,
				sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
			assert.equal(provenance.representation, 'camera-embedded'); assert.equal(provenance.orientation, 1);
			assert.ok(provenance.runtimeVersion.includes('libraw-0.22.2')); assert.ok(provenance.runtimeVersion.includes('modeled-browser-jpeg-1'));
			assert.equal(value.pixels[0], 17); assert.ok(value.pixels instanceof Uint8Array); output = value.pixels; return 'camera';
		}, ports), 'camera');
		assert.ok(output?.every(byte => byte === 0)); assert.deepEqual(bytes, before); assert.equal(workers.statistics.created, 1);
	} finally { await workers.close(); }
});

test('Actual no-preview DNG joins preview extraction before the actual neutral Original worker fallback', async () => {
	const bytes = rawDngFixtureV1(6).bytes, workers = await rawWorkerFixtureV1(), jobs: string[] = [];
	const ports: PhotoCullingFramePortsCurrentV1 = {
		withRawPreview(value, consume) { assert.equal(this, ports); jobs.push('preview'); return withRawEmbeddedPreviewV1(value, consume,
			{ loadModule: moduleBytes, createWorker: workers.createWorker }); },
		async openImage() { assert.fail('No-preview DNG must not enter JPEG decoding.'); },
		withOriginalFrame(value, consume) {
			assert.equal(this, ports); assert.equal(workers.active(), 0); assert.equal(workers.statistics.joined, 1); jobs.push('original');
			return withPhotoPreviewOriginalFrameCurrentV1(value, consume, { withRawFrame: (input, borrow) => withDecodedRawOriginalV1(input, borrow,
				{ loadModule: moduleBytes, createWorker: workers.createWorker }) });
		},
	};
	try {
		await withPhotoCullingFrameCurrentV1(request(bytes), async (value, provenance) => {
			assert.equal(provenance.representation, 'neutral-original'); assert.equal(provenance.orientation, 6);
			assert.deepEqual([value.descriptor.width, value.descriptor.height, value.descriptor.sampleFormat, value.descriptor.transfer], [32, 32, 'unorm8', 'srgb']);
			assert.equal(workers.active(), 0); assert.equal(workers.statistics.joined, 2);
			assert.ok(value.pixels[(8 * 32 + 8) * 4 + 2]! > value.pixels[(8 * 32 + 8) * 4]!, 'Real oriented Bayer blue patch remains blue.');
		}, ports);
		assert.deepEqual(jobs, ['preview', 'original']); assert.equal(workers.statistics.created, 2);
	} finally { await workers.close(); }
});

test('Camera orientation is applied exactly once for all native RAW flips and all browser-applied JPEG EXIF orientations', async () => {
	for (let exif = 1; exif <= 8; exif++) for (let orientation = 1; orientation <= 8; orientation++) {
		const model = modeledPorts(exif, orientation); let output: Uint8Array | undefined;
		await withPhotoCullingFrameCurrentV1(request(rawDngFixtureV1().bytes), async (value, provenance) => {
			assert.deepEqual([...value.pixels], [...rgba(ORDERS[orientation]!)], `EXIF ${exif}, native ${orientation}`);
			assert.deepEqual([value.descriptor.width, value.descriptor.height], orientation >= 5 ? [3, 2] : [2, 3]);
			assert.equal(provenance.orientation, orientation); assert.equal(provenance.representation, 'camera-embedded');
			assert.equal(model.closed(), 1); assert.ok(model.pixels.every(byte => byte === 0)); assert.ok(model.compressed.every(byte => byte === 0));
			assert.ok(value.pixels instanceof Uint8Array); output = value.pixels;
		}, model.ports);
		assert.ok(output?.every(byte => byte === 0)); assert.equal(model.fallback(), 0);
	}
});

test('Explicit unsupported bitmap falls back only after the extracted native preview backing has retired', async () => {
	for (const bits of [8, 16]) {
		const bytes = new Uint8Array(bits / 8 * 6).fill(37); let fallback = 0;
		const ports: PhotoCullingFramePortsCurrentV1 = {
			async withRawPreview(_value, consume) {
				try { return await consume({ type: 'bitmap', width: 2, height: 1, channels: 3, bits, rawFlip: 0, bytes }); }
				finally { bytes.fill(0); }
			},
			async openImage() { assert.fail('Unqualified native bitmap is not encoded JPEG.'); },
			async withOriginalFrame(_value, consume) { assert.ok(bytes.every(byte => byte === 0)); fallback++; return consume(frame(), { orientation: 1, runtimeVersion: 'neutral-1' }); },
		};
		await withPhotoCullingFrameCurrentV1(request(rawDngFixtureV1().bytes), async (_value, provenance) => { assert.equal(provenance.representation, 'neutral-original'); }, ports);
		assert.equal(fallback, 1);
	}
});

test('Legacy non-RAW bytes delegate to the pinned neutral Original capability without opening a RAW worker', async () => {
	const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ports = modeledPorts().ports;
	let calls = 0;
	const old = ports.withOriginalFrame!;
	const owned = { ...ports, async withRawPreview() { assert.fail('Legacy bytes must not open LibRaw.'); },
		withOriginalFrame: function<Value>(value: unknown, consume: Parameters<typeof withPhotoPreviewOriginalFrameCurrentV1<Value>>[1]) {
			assert.equal(this, owned); calls++; return Reflect.apply(old, ports, [value, consume]) as Promise<Value>;
		} };
	await withPhotoCullingFrameCurrentV1(request(bytes, 1, 1), async (_value, provenance) => { assert.equal(provenance.representation, 'neutral-original'); }, owned);
	assert.equal(calls, 1);
});

test('Held consumer cancellation joins the borrow and wipes output while preserving the exact opaque cancellation reason', async () => {
	const model = modeledPorts(), controller = new AbortController(), entered = deferred<void>(), release = deferred<void>(), reason = Symbol('culling-cancel');
	let output: Uint8Array | undefined, settled = false;
	const task = observe(withPhotoCullingFrameCurrentV1({ ...request(rawDngFixtureV1().bytes), signal: controller.signal }, async value => {
		assert.ok(value.pixels instanceof Uint8Array); output = value.pixels; entered.resolve(undefined); await release.promise; return 'held';
	}, model.ports)).then(value => { settled = true; return value; });
	await entered.promise; controller.abort(reason); await Promise.resolve(); assert.equal(settled, false);
	assert.equal(model.closed(), 1); assert.ok(output?.some(byte => byte !== 0)); release.resolve(undefined);
	const result = await task; assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, reason);
	assert.ok(output?.every(byte => byte === 0));
});

test('Retained Original digest and closed port admission refuse before lazy decoder work or fallback', async () => {
	const bytes = rawDngFixtureV1().bytes, model = modeledPorts(), original = request(bytes);
	await assert.rejects(withPhotoCullingFrameCurrentV1({ ...original, binding: { ...original.binding, contentSha256: '0'.repeat(64) } }, async () => {}, model.ports), /SHA|digest/u);
	assert.equal(model.preview(), 0); assert.equal(model.fallback(), 0);
	let getter = 0;
	const invalid = { get withRawPreview() { getter++; return model.ports.withRawPreview; } };
	await assert.rejects(withPhotoCullingFrameCurrentV1(original, async () => {}, invalid), TypeError); assert.equal(getter, 0);
	await assert.rejects(withPhotoCullingFrameCurrentV1({ ...original, source: 'developed' }, async () => {}, model.ports), /source|camera/u);
	const controller = new AbortController(), reason = Symbol('pre-aborted'); controller.abort(reason);
	const result = await observe(withPhotoCullingFrameCurrentV1({ ...original, signal: controller.signal }, async () => {}, model.ports));
	assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error, reason); assert.equal(model.preview(), 0);
});

test('Camera preview failure and native cleanup failure retain both opaque authorities and never fall back', async () => {
	const decodeFailure = Symbol('jpeg-decode'), cleanupFailure = Symbol('jpeg-close'), model = modeledPorts();
	const openImage: OpenFramescaperBrowserNativeImageV1 = async () => ({
		metadata: { width: 2, height: 3, frameCount: 1, topology: 'single', runtimeVersion: 'model-1' },
		async decodeFrame() { throw decodeFailure; }, close() { throw cleanupFailure; },
	});
	const result = await observe(withPhotoCullingFrameCurrentV1(request(rawDngFixtureV1().bytes), async () => assert.fail('Failed preview cannot publish.'), {
		withRawPreview<Value>(value: unknown, consume: Parameters<typeof withRawEmbeddedPreviewV1<Value>>[1]) {
			return Reflect.apply(model.ports.withRawPreview!, model.ports, [value, consume]) as Promise<Value>;
		}, openImage,
		withOriginalFrame<Value>(value: unknown, consume: Parameters<typeof withPhotoPreviewOriginalFrameCurrentV1<Value>>[1]) {
			return Reflect.apply(model.ports.withOriginalFrame!, model.ports, [value, consume]) as Promise<Value>;
		},
	}));
	assert.equal(result.ok, false);
	if (!result.ok) { assert.ok(result.error instanceof AggregateError); assert.ok(result.error.errors.includes(decodeFailure)); assert.ok(result.error.errors.includes(cleanupFailure)); }
	assert.equal(model.fallback(), 0); assert.ok(model.compressed.every(byte => byte === 0));
});

test('Detached public output reports physical retirement failure rather than silently accepting an unwiped frame', async () => {
	const model = modeledPorts();
	const result = await observe(withPhotoCullingFrameCurrentV1(request(rawDngFixtureV1().bytes), async value => {
		assert.ok(value.pixels.buffer instanceof ArrayBuffer); structuredClone(value.pixels.buffer, { transfer: [value.pixels.buffer] });
	}, model.ports));
	assert.equal(result.ok, false); if (!result.ok) assert.ok(result.error instanceof TypeError);
});

test('Native decoder methods and receiver are pinned before a held RAW preview yields', async () => {
	const model = modeledPorts(), entered = deferred<void>(), release = deferred<void>();
	const ports: PhotoCullingFramePortsCurrentV1 = {
		async withRawPreview<Value>(value: unknown, consume: Parameters<typeof withRawEmbeddedPreviewV1<Value>>[1]): Promise<Value> {
			assert.equal(this, ports); entered.resolve(undefined); await release.promise;
			return await (Reflect.apply(model.ports.withRawPreview!, model.ports, [value, consume]) as Promise<Value>);
		},
		openImage(value) { assert.equal(this, ports); return Reflect.apply(model.ports.openImage!, model.ports, [value]) as ReturnType<OpenFramescaperBrowserNativeImageV1>; },
		async withOriginalFrame() { assert.fail('The admitted JPEG never requires fallback.'); },
	};
	const task = withPhotoCullingFrameCurrentV1(request(rawDngFixtureV1().bytes), async value => [...value.pixels], ports);
	await entered.promise;
	Object.defineProperty(ports, 'openImage', { value: () => { assert.fail('Late native method replacement must not be consulted.'); }, enumerable: true });
	release.resolve(undefined); assert.deepEqual(await task, [...rgba(ORDERS[1])]);
});
