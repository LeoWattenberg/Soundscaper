/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compilePinnedLibRawModuleV1 } from '../src/common/editor/raw/libraw-runtime-asset-v1.ts';
import { withDecodedRawFrameV1, withRawEmbeddedPreviewV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';
import type { LibRawRuntimeOptionsV1 } from '../src/common/editor/raw/libraw-runtime-v1.ts';
import { rawDngFixtureV1, rawDngSensorSample } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { rawWorkerFixtureV1 } from './helpers/lightscaper-raw-worker-current-fixture.ts';

type Call = (...args: number[]) => number;
type RawApi = WebAssembly.Exports & Readonly<{ memory: WebAssembly.Memory; _initialize: Call;
	raw_abi_version: Call; raw_input_alloc: Call; raw_open: Call; raw_decode: Call; raw_output_ptr: Call; raw_output_bytes: Call;
	raw_output_width: Call; raw_output_height: Call; raw_output_channels: Call; raw_output_bits: Call;
	raw_preview: Call; raw_preview_ptr: Call; raw_preview_bytes: Call; raw_preview_type: Call;
	raw_preview_width: Call; raw_preview_height: Call; raw_preview_channels: Call; raw_preview_bits: Call; raw_flip: Call; raw_destroy: Call }>;
const WASM = new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url);
let compiled: Promise<WebAssembly.Module> | undefined;
function moduleBytes(): Promise<WebAssembly.Module> {
	compiled ??= readFile(WASM).then(bytes => compilePinnedLibRawModuleV1(new Uint8Array(bytes))); return compiled;
}

/** Real standalone C ABI, with no filesystem authority. These imports implement
 * inert unavailable WASI descriptors/native abort hooks, never image decoding. */
async function native() {
	const module = await moduleBytes(), allowed = new Set(['env.abort', 'env.emscripten_notify_memory_growth',
		'wasi_snapshot_preview1.fd_read', 'wasi_snapshot_preview1.fd_close', 'wasi_snapshot_preview1.fd_write', 'wasi_snapshot_preview1.fd_seek', 'wasi_snapshot_preview1.proc_exit']);
	for (const item of WebAssembly.Module.imports(module)) {
		assert.equal(item.kind, 'function'); assert.ok(allowed.has(`${item.module}.${item.name}`));
	}
	const abort = () => { throw new Error('Actual LibRaw WASM aborted.'); };
	const instance = new WebAssembly.Instance(module, { env: { abort, emscripten_notify_memory_growth() {} },
		wasi_snapshot_preview1: { fd_read: () => 8, fd_close: () => 8, fd_write: () => 8, fd_seek: () => 8, proc_exit: abort } });
	const api = instance.exports as RawApi; assert.ok(api.memory instanceof WebAssembly.Memory); api._initialize();
	assert.equal(api.raw_abi_version(), 1);
	return { api, memory: api.memory, close() { try { api.raw_destroy(); } finally { new Uint8Array(api.memory.buffer).fill(0); } } };
}
function open(api: RawApi, bytes: Uint8Array): number {
	const pointer = api.raw_input_alloc(bytes.byteLength); assert.ok(pointer > 0);
	new Uint8Array(api.memory.buffer, pointer, bytes.byteLength).set(bytes); assert.equal(api.raw_open(), 0); return pointer;
}
function rgb(api: RawApi): Uint16Array<ArrayBuffer> {
	assert.deepEqual([api.raw_output_width(), api.raw_output_height(), api.raw_output_channels(), api.raw_output_bits()], [32, 32, 3, 16]);
	const pointer = api.raw_output_ptr(), length = api.raw_output_bytes(); assert.equal(length, 32 * 32 * 6); assert.ok(pointer > 0 && pointer % 2 === 0);
	return new Uint16Array(api.memory.buffer, pointer, length / 2);
}
function pixel(words: Uint16Array, channels: 3 | 4, x: number, y: number): number[] {
	return [...words.subarray((y * 32 + x) * channels, (y * 32 + x) * channels + 3)];
}
function assertNativePrecision(words: Uint16Array, channels: 3 | 4): void {
	const low = pixel(words, channels, 8, 8), high = pixel(words, channels, 24, 8);
	// Raw flat fields differ by exactly one 12-bit code. Distinct linear words
	// within a single 8-bit bin cannot have come from an expanded byte preview.
	for (const channel of [0, 1, 2] as const) {
		assert.ok(low[channel]! > 0 && high[channel]! > low[channel]!);
		assert.ok(high[channel]! - low[channel]! <= 64); assert.equal(Math.floor(low[channel]! / 257), Math.floor(high[channel]! / 257));
	}
	const blue = pixel(words, channels, 8, 24), red = pixel(words, channels, 24, 24);
	assert.ok(blue[2]! > blue[0]!, 'The blue Bayer patch must remain blue-dominant.');
	assert.ok(red[0]! > red[2]!, 'The red Bayer patch must remain red-dominant.');
}
function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>(done => { resolve = done; }); return { promise, resolve };
}
function observe<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
async function cameraBytes(): Promise<Uint8Array<ArrayBuffer>> {
	const bytes = new Uint8Array(await readFile(new URL('../vendor/lightscaper-raw-fixtures/D60.CRW', import.meta.url)));
	assert.equal(bytes.length, 4_363_206);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), '168d5d5cad67364a0ee01fa2e0d1847f3ef9c94e5593a4699bb5eb7743fa4be2');
	return bytes;
}
/** Independent JPEG marker reader: validates actual compressed preview geometry;
 * it neither decodes entropy nor obtains dimensions from the production bridge. */
function jpegGeometry(bytes: Uint8Array) {
	assert.deepEqual([...bytes.subarray(0, 2)], [255, 216]);
	for (let at = 2; at < bytes.length;) {
		assert.equal(bytes[at++], 255); while (bytes[at] === 255) at++;
		const marker = bytes[at++]; assert.notEqual(marker, undefined);
		if (marker === 218 || marker === 217) break;
		if (marker === 1 || (marker! >= 208 && marker! <= 215)) continue;
		assert.ok(at + 2 <= bytes.length); const length = bytes[at]! * 256 + bytes[at + 1]!;
		assert.ok(length >= 2 && at + length <= bytes.length);
		if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker!)) {
			assert.ok(length >= 8); return { bits: bytes[at + 2]!, height: bytes[at + 3]! * 256 + bytes[at + 4]!,
				width: bytes[at + 5]! * 256 + bytes[at + 6]!, channels: bytes[at + 7]! };
		}
		at += length;
	}
	throw new Error('Actual embedded JPEG has no bounded frame header.');
}

test('Owned DNG is a real little-endian RGGB container with independent greater-than-byte sensor literals', () => {
	const fixture = rawDngFixtureV1(), view = new DataView(fixture.bytes.buffer);
	assert.deepEqual([...fixture.bytes.subarray(0, 8)], [73, 73, 42, 0, 8, 0, 0, 0]);
	assert.ok(fixture.bytes.length < 4096); assert.equal(fixture.sensor.length, 1024);
	for (const [x, y, expected] of [[8, 8, 1024], [24, 8, 1025], [8, 24, 768], [9, 24, 1536], [9, 25, 3072], [24, 24, 3072]]) {
		assert.equal(rawDngSensorSample(x!, y!), expected); assert.equal(view.getUint16(fixture.rawOffset + (y! * 32 + x!) * 2, true), expected);
	}
});

test('Actual pinned LibRaw C ABI rejects invalid states and input bounds without allocating an image', async () => {
	const n = await native();
	try {
		assert.notEqual(n.api.raw_open(), 0); assert.notEqual(n.api.raw_decode(), 0); assert.notEqual(n.api.raw_preview(), 0);
		assert.equal(n.api.raw_input_alloc(0), 0); assert.equal(n.api.raw_input_alloc(64 * 1024 * 1024 + 1), 0);
		assert.equal(n.api.raw_output_ptr(), 0); assert.equal(n.api.raw_output_bytes(), 0); assert.equal(n.api.raw_preview_ptr(), 0);
	} finally { n.close(); }
});

test('Actual LibRaw opens and demosaics the owned DNG to native linear RGB16 with independent sub-byte precision and color evidence', async () => {
	const n = await native(), fixture = rawDngFixtureV1(), before = fixture.bytes.slice();
	try {
		const input = open(n.api, fixture.bytes); assert.equal(n.api.raw_flip(), 0); assert.equal(n.api.raw_decode(), 0);
		const words = rgb(n.api); assertNativePrecision(words, 3); assert.notEqual(n.api.raw_decode(), 0);
		assert.deepEqual(new Uint8Array(n.memory.buffer, input, before.length), before); assert.deepEqual(fixture.bytes, before);
		const output = n.api.raw_output_ptr(), outputBytes = n.api.raw_output_bytes();
		n.api.raw_destroy(); assert.equal(n.api.raw_output_ptr(), 0); assert.equal(n.api.raw_output_bytes(), 0);
		// Free-list bookkeeping may reuse a freed allocation's leading words;
		// native payload interiors must already be wiped before whole-heap retirement.
		assert.ok(new Uint8Array(n.memory.buffer, input + 64, before.length - 128).every(byte => byte === 0));
		assert.ok(new Uint8Array(n.memory.buffer, output + 64, outputBytes - 128).every(byte => byte === 0));
	} finally { n.close(); }
});

test('Actual LibRaw applies DNG orientation to decoded pixels while retaining the original native flip scalar', async () => {
	const n = await native();
	try {
		open(n.api, rawDngFixtureV1(6).bytes); assert.equal(n.api.raw_flip(), 6); assert.equal(n.api.raw_decode(), 0);
		const words = rgb(n.api), topLeft = pixel(words, 3, 8, 8), topRight = pixel(words, 3, 24, 8);
		assert.ok(topLeft[2]! > topLeft[0]!, 'Clockwise orientation moves the lower-left blue patch to the upper-left.');
		assert.ok(Math.abs(topRight[0]! - topRight[2]!) < 64, 'Clockwise orientation moves a gray patch to the upper-right.');
	} finally { n.close(); }
});

test('Actual no-preview DNG reports absent embedded preview without substituting developed pixels', async () => {
	const n = await native();
	try {
		open(n.api, rawDngFixtureV1().bytes); assert.ok([-5, -6].includes(n.api.raw_preview()));
		assert.equal(n.api.raw_preview_ptr(), 0); assert.equal(n.api.raw_preview_bytes(), 0); assert.equal(n.api.raw_output_ptr(), 0);
	} finally { n.close(); }
});

test('Actual LibRaw refuses corrupt bytes, destroys its failed native instance and admits a fresh DNG afterward', async () => {
	const n = await native();
	try {
		const pointer = n.api.raw_input_alloc(64); assert.ok(pointer > 0); new Uint8Array(n.memory.buffer, pointer, 64).fill(17);
		assert.notEqual(n.api.raw_open(), 0); assert.equal(n.api.raw_output_ptr(), 0); assert.equal(n.api.raw_input_alloc(1), 0);
		n.api.raw_destroy(); open(n.api, rawDngFixtureV1().bytes); assert.equal(n.api.raw_decode(), 0); assertNativePrecision(rgb(n.api), 3);
	} finally { n.close(); }
});

test('Actual pinned Canon D60 CRW unpacks proprietary camera data and retains its real compressed embedded JPEG', async () => {
	const n = await native(), bytes = await cameraBytes(), before = bytes.slice();
	try {
		open(n.api, bytes); assert.ok(n.api.raw_flip() >= 0 && n.api.raw_flip() <= 7);
		assert.equal(n.api.raw_preview(), 0); assert.equal(n.api.raw_preview_type(), 1);
		const previewPointer = n.api.raw_preview_ptr(), previewLength = n.api.raw_preview_bytes();
		assert.ok(previewPointer > 0 && previewLength > 0 && previewLength <= 16 * 1024 * 1024);
		const jpeg = new Uint8Array(n.memory.buffer, previewPointer, previewLength).slice(), geometry = jpegGeometry(jpeg);
		assert.deepEqual(geometry, { width: n.api.raw_preview_width(), height: n.api.raw_preview_height(),
			channels: n.api.raw_preview_channels(), bits: n.api.raw_preview_bits() });
		assert.equal(geometry.bits, 8); assert.ok(geometry.width > 0 && geometry.height > 0);
		assert.equal(n.api.raw_decode(), 0);
		// Pinned upstream identify.cpp Canon table uses raw 3152x2068 minus
		// margins 64x12, with no extra decrement: full active 3088x2056.
		// The camera's 3072x2048 JPEG crop is a separate product presentation.
		assert.deepEqual([n.api.raw_output_width(), n.api.raw_output_height(), n.api.raw_output_channels(), n.api.raw_output_bits()], [3088, 2056, 3, 16]);
		assert.equal(n.api.raw_output_bytes(), 3088 * 2056 * 6); assert.ok(n.api.raw_output_ptr() > 0);
		assert.deepEqual(bytes, before);
		// This is a licensed lens-cap photograph: no scene/color breadth claim.
	} finally { n.close(); }
});

test('Actual production worker transfers DNG RGBA16 and joins its native thread before consumption and physical output wiping', async () => {
	const workers = await rawWorkerFixtureV1(), bytes = rawDngFixtureV1().bytes, before = bytes.slice();
	let backing: ArrayBuffer | undefined;
	try {
		const result = await withDecodedRawFrameV1({ bytes }, frame => {
			assert.equal(workers.active(), 0); assert.equal(workers.statistics.joined, 1); assert.equal(workers.statistics.exits, 1);
			assert.deepEqual([frame.descriptor.width, frame.descriptor.height, frame.descriptor.sampleFormat, frame.descriptor.primaries, frame.descriptor.transfer], [32, 32, 'unorm16', 'srgb', 'linear']);
			assert.ok(frame.pixels instanceof Uint16Array); assertNativePrecision(frame.pixels, 4);
			for (let at = 3; at < frame.pixels.length; at += 4) assert.equal(frame.pixels[at], 65535);
			backing = frame.pixels.buffer; return 'native-consumed';
		}, { loadModule: moduleBytes, createWorker: workers.createWorker });
		assert.equal(result, 'native-consumed'); assert.ok(backing); assert.ok(new Uint8Array(backing).every(value => value === 0));
		assert.deepEqual(bytes, before); assert.deepEqual(workers.statistics, { created: 1, posts: 1, messages: 1, terminations: 1, joined: 1, exits: 1 });
		assert.ok(workers.events.indexOf('exit') < workers.events.indexOf('joined'));
	} finally { await workers.close(); }
});

test('Actual production worker decodes the synchronously owned input snapshot across a held module load', async () => {
	const workers = await rawWorkerFixtureV1(), bytes = rawDngFixtureV1().bytes, loading = deferred<void>(), release = deferred<WebAssembly.Module>();
	const options: LibRawRuntimeOptionsV1 = {
		loadModule() { assert.equal(this, options); loading.resolve(undefined); return release.promise; },
		createWorker() { assert.equal(this, options); return workers.createWorker(); },
	};
	let task: Promise<string> | undefined;
	try {
		task = withDecodedRawFrameV1({ bytes }, frame => { assertNativePrecision(frame.pixels, 4); return 'captured'; }, options);
		await loading.promise; assert.equal(workers.statistics.created, 0); bytes.fill(0); release.resolve(await moduleBytes());
		assert.equal(await task, 'captured'); assert.ok(bytes.every(value => value === 0)); assert.equal(workers.statistics.joined, 1);
	} finally { release.resolve(await moduleBytes()); if (task) await Promise.allSettled([task]); await workers.close(); }
});

test('Actual native output remains owned through held consumption and retires after cancellation with its exact opaque reason', async () => {
	const workers = await rawWorkerFixtureV1(), bytes = rawDngFixtureV1().bytes, before = bytes.slice();
	const entered = deferred<ArrayBuffer>(), release = deferred<void>(), controller = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let settled = false;
	const task = withDecodedRawFrameV1({ bytes, signal: controller.signal }, async frame => {
		assert.equal(workers.statistics.joined, 1); entered.resolve(frame.pixels.buffer); await release.promise; return 'late';
	}, { loadModule: moduleBytes, createWorker: workers.createWorker });
	const observed = observe(task).then(outcome => { settled = true; return outcome; });
	try {
		const backing = await Promise.race([entered.promise, observed.then(() => { throw new Error('Native consumer never entered its held scope.'); })]);
		controller.abort(opaque.proxy); await Promise.resolve();
		assert.equal(settled, false); assert.ok(new Uint8Array(backing).some(value => value !== 0));
		release.resolve(undefined); const outcome = await observed; assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy));
		assert.ok(new Uint8Array(backing).every(value => value === 0)); assert.deepEqual(bytes, before); assert.equal(workers.active(), 0);
	} finally { release.resolve(undefined); await Promise.allSettled([task]); await workers.close(); }
});

test('Actual production worker preserves an opaque consumer failure and wipes the captured physical native plane', async () => {
	const workers = await rawWorkerFixtureV1(), opaque = Proxy.revocable({}, {}); opaque.revoke(); let backing: ArrayBuffer | undefined;
	try {
		const outcome = await observe(withDecodedRawFrameV1({ bytes: rawDngFixtureV1().bytes }, frame => {
			backing = frame.pixels.buffer; Object.defineProperty(frame.pixels, 'buffer', { value: new ArrayBuffer(1) }); throw opaque.proxy;
		}, { loadModule: moduleBytes, createWorker: workers.createWorker }));
		assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy));
		assert.ok(backing); assert.ok(new Uint8Array(backing).every(value => value === 0)); assert.equal(workers.statistics.joined, 1);
	} finally { await workers.close(); }
});

test('Actual production worker returns null for no-preview DNG and never substitutes its developed frame', async () => {
	const workers = await rawWorkerFixtureV1(); let consumed = false;
	try {
		await withRawEmbeddedPreviewV1({ bytes: rawDngFixtureV1().bytes }, preview => {
			consumed = true; assert.equal(preview, null); assert.equal(workers.statistics.joined, 1); assert.equal(workers.active(), 0);
		}, { loadModule: moduleBytes, createWorker: workers.createWorker });
		assert.equal(consumed, true);
	} finally { await workers.close(); }
});

test('Actual production worker returns the pinned camera JPEG with truthful independently read geometry and scoped body retirement', async () => {
	const workers = await rawWorkerFixtureV1(), bytes = await cameraBytes(), before = bytes.slice(); let backing: ArrayBuffer | undefined;
	try {
		await withRawEmbeddedPreviewV1({ bytes }, preview => {
			assert.ok(preview); assert.equal(preview.type, 'jpeg'); assert.equal(workers.statistics.joined, 1); assert.equal(workers.active(), 0);
			assert.deepEqual(jpegGeometry(preview.bytes), { width: preview.width, height: preview.height, channels: preview.channels, bits: preview.bits });
			assert.ok(preview.rawFlip >= 0 && preview.rawFlip <= 7); backing = preview.bytes.buffer;
		}, { loadModule: moduleBytes, createWorker: workers.createWorker });
		assert.ok(backing); assert.ok(new Uint8Array(backing).every(value => value === 0)); assert.deepEqual(bytes, before);
	} finally { await workers.close(); }
});

test('Actual production worker refuses native corrupt input without a consumer call and joins the failed decoder thread', async () => {
	const workers = await rawWorkerFixtureV1(); let consumed = false;
	try {
		await assert.rejects(withDecodedRawFrameV1({ bytes: new Uint8Array(64).fill(17) }, () => { consumed = true; },
			{ loadModule: moduleBytes, createWorker: workers.createWorker }), /LibRaw raw_open failed/);
		assert.equal(consumed, false); assert.equal(workers.statistics.joined, 1); assert.equal(workers.active(), 0);
	} finally { await workers.close(); }
});
