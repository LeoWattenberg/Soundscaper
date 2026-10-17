/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decodeLibRawOriginalWasmV1 } from '../src/common/editor/raw/libraw-wasm-instance-v1.ts';
import { decodeLibRawRecoveryWasmV2 } from '../src/common/editor/raw/libraw-wasm-instance-v2.ts';
import { RAW_RECOVERY_BLACK, RAW_RECOVERY_HEIGHT, RAW_RECOVERY_HIGHLIGHT_RED, RAW_RECOVERY_ROIS, RAW_RECOVERY_WHITE,
	RAW_RECOVERY_WIDTH, rawRecoveryDngFixtureV1, rawRecoverySensorSampleV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';
import type { RawRecoveryOrientationV1, RawRecoveryRoiV1 } from './helpers/lightscaper-raw-recovery-dng-current-fixture.ts';

type Recovery = ReturnType<typeof decodeLibRawRecoveryWasmV2>;
type Call = (...args: number[]) => number;
type RawApi = WebAssembly.Exports & Readonly<{ memory: WebAssembly.Memory; _initialize: Call;
	raw_abi_version: Call; raw_profile_version: Call; raw_input_alloc: Call; raw_open: Call; raw_decode: Call;
	raw_output_ptr: Call; raw_output_bytes: Call; raw_output_width: Call; raw_output_height: Call;
	raw_output_channels: Call; raw_output_bits: Call; raw_flip: Call; raw_highlight_mode: Call;
	raw_exposure_scale: Call; raw_destroy: Call }>;
const ROOT = new URL('../', import.meta.url), PROFILES = ['linear-headroom-v1', 'highlight-recovery-v1'] as const;
const IMPORTS = ['env.emscripten_notify_memory_growth', 'wasi_snapshot_preview1.fd_close', 'wasi_snapshot_preview1.fd_read',
	'wasi_snapshot_preview1.fd_seek', 'wasi_snapshot_preview1.fd_write'];
const EXPORTS = ['memory', '_initialize', 'raw_abi_version', 'raw_profile_version', 'raw_input_alloc', 'raw_open', 'raw_decode',
	'raw_output_ptr', 'raw_output_bytes', 'raw_output_width', 'raw_output_height', 'raw_output_channels', 'raw_output_bits',
	'raw_flip', 'raw_highlight_mode', 'raw_exposure_scale', 'raw_destroy', '__indirect_function_table', '__trap'];
let compiled: Promise<WebAssembly.Module> | undefined;
async function loadModule(): Promise<WebAssembly.Module> {
	compiled ??= (async () => {
		const manifest: unknown = JSON.parse(await readFile(new URL('config/lightscaper-libraw-recovery-runtime-manifest.json', ROOT), 'utf8'));
		assert.ok(manifest && typeof manifest === 'object'); const runtime: unknown = Reflect.get(manifest, 'runtime');
		assert.ok(runtime && typeof runtime === 'object'); const path: unknown = Reflect.get(runtime, 'path'); assert.equal(typeof path, 'string');
		const location = process.env.LIGHTSCAPER_RECOVERY_WASM ?? new URL(path as string, ROOT);
		const bytes = new Uint8Array(await readFile(location)); assert.ok(bytes.length > 0 && bytes.length <= 8 * 1024 * 1024);
		return WebAssembly.compile(bytes);
	})(); return compiled;
}
async function native() {
	const module = await loadModule();
	assert.deepEqual(WebAssembly.Module.imports(module).map(item => { assert.equal(item.kind, 'function'); return `${item.module}.${item.name}`; }).sort(), [...IMPORTS].sort());
	assert.deepEqual(WebAssembly.Module.exports(module).map(item => item.name).sort(), [...EXPORTS].sort());
	const instance = new WebAssembly.Instance(module, { env: { emscripten_notify_memory_growth() {} },
		wasi_snapshot_preview1: { fd_read: () => 8, fd_close: () => 8, fd_write: () => 8, fd_seek: () => 8 } });
	const api = instance.exports as RawApi; assert.ok(api.memory instanceof WebAssembly.Memory); api._initialize();
	assert.equal(api.raw_abi_version(), 2); assert.equal(api.raw_profile_version(), 1);
	return { api, close() { try { api.raw_destroy(); } finally { new Uint8Array(api.memory.buffer).fill(0); } } };
}
function open(api: RawApi, bytes: Uint8Array<ArrayBuffer>): number {
	const pointer = api.raw_input_alloc(bytes.length); assert.ok(pointer > 0);
	new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes); assert.equal(api.raw_open(), 0); return pointer;
}
function rgb(api: RawApi, width: number, height: number): Float32Array<ArrayBuffer> {
	assert.deepEqual([api.raw_output_width(), api.raw_output_height(), api.raw_output_channels(), api.raw_output_bits()], [width, height, 3, 32]);
	const pointer = api.raw_output_ptr(); assert.ok(pointer > 0 && pointer % 4 === 0); assert.equal(api.raw_output_bytes(), width * height * 12);
	return new Float32Array(api.memory.buffer, pointer, width * height * 3);
}
function hash(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function wipe(...values: Recovery[]): void { for (const value of values) value.frame.pixels.fill(0); }
function mean(value: Recovery, roi: RawRecoveryRoiV1, channel: number): number {
	let sum = 0;
	for (let y = roi.y; y < roi.y + roi.height; y++) for (let x = roi.x; x < roi.x + roi.width; x++) sum += value.frame.pixels[(y * value.frame.descriptor.width + x) * 4 + channel]!;
	return sum / (roi.width * roi.height);
}
function spread(value: Recovery, roi: RawRecoveryRoiV1, channel: number): number {
	let minimum = Infinity, maximum = -Infinity;
	for (let y = roi.y; y < roi.y + roi.height; y++) for (let x = roi.x; x < roi.x + roi.width; x++) {
		const sample = value.frame.pixels[(y * value.frame.descriptor.width + x) * 4 + channel]!; minimum = Math.min(minimum, sample); maximum = Math.max(maximum, sample);
	}
	return maximum - minimum;
}
function checkFrame(value: Recovery, width: number, height: number): void {
	assert.deepEqual(value.frame.descriptor, { schemaVersion: 1, width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' });
	assert.ok(value.frame.pixels instanceof Float32Array); assert.equal(value.frame.pixels.length, width * height * 4);
	assert.equal(value.frame.pixels.byteOffset, 0); assert.equal(value.frame.pixels.buffer.byteLength, width * height * 16);
	assert.ok(value.frame.pixels.every(Number.isFinite));
	for (let at = 3; at < value.frame.pixels.length; at += 4) assert.equal(value.frame.pixels[at], 1);
}
/** These are scene invariants, not a reimplementation of LibRaw's map growth,
 * AHD demosaic, white-balance scaling, or color conversion. */
function assertRecoveryEvidence(headroom: Recovery, recovered: Recovery): void {
	assert.equal(headroom.exposureScale, recovered.exposureScale);
	assert.ok(headroom.exposureScale > 1.5 && headroom.exposureScale < 2.5, 'The fixture must exercise unequal native WB/headroom.');
	for (const channel of [0, 1, 2]) {
		assert.equal(mean(recovered, RAW_RECOVERY_ROIS.midtone, channel), mean(headroom, RAW_RECOVERY_ROIS.midtone, channel));
		assert.ok(spread(recovered, RAW_RECOVERY_ROIS.saturated, channel) < 0.0001, 'Fully clipped constant sensor data cannot supply spatial texture.');
	}
	for (const channel of [1, 2]) {
		const base = RAW_RECOVERY_ROIS.highlights.map(roi => mean(headroom, roi, channel));
		const result = RAW_RECOVERY_ROIS.highlights.map(roi => mean(recovered, roi, channel));
		assert.ok(Math.max(...base) - Math.min(...base) < 0.005, 'The nonreference input must actually be clipped across the four slabs.');
		assert.ok(result[3]! - result[0]! > 0.4, 'Recovery must restore nonreference contrast from the surviving reference channel.');
		for (let index = 0; index < result.length; index++) {
			if (index > 0) assert.ok(result[index]! - result[index - 1]! > 0.1, 'Recovered slab detail must be strictly ordered.');
			const roi = RAW_RECOVERY_ROIS.highlights[index]!, reference = mean(recovered, roi, 0);
			assert.ok(Math.abs(result[index]! - reference) < 0.03, 'The neutral ratio seed must constrain reconstructed neutral color.');
			assert.ok(Math.abs(reference - mean(headroom, roi, 0)) < 0.001, 'Recovery must preserve the unsaturated reference detail.');
		}
	}
}

test('Owned recovery DNG contains literal unequal-WB Bayer detail, saturation, midtone and no-information controls', () => {
	const fixture = rawRecoveryDngFixtureV1(), view = new DataView(fixture.bytes.buffer);
	assert.deepEqual([...fixture.bytes.subarray(0, 8)], [73, 73, 42, 0, 8, 0, 0, 0]);
	assert.deepEqual([fixture.width, fixture.height, fixture.sensor.length], [128, 96, 128 * 96]); assert.ok(fixture.bytes.length < 32 * 1024);
	assert.deepEqual([RAW_RECOVERY_BLACK, RAW_RECOVERY_WHITE], [64, 4095]);
	for (const [x, y, expected] of [[12, 8, 1777], [13, 8, 3490], [12, 40, 568], [13, 40, 1072],
		[36, 40, 2281], [48, 40, 2684], [60, 40, 3087], [72, 40, 3490], [37, 40, 4095], [101, 41, 4095]]) {
		assert.equal(rawRecoverySensorSampleV1(x!, y!), expected); assert.equal(view.getUint16(fixture.rawOffset + (y! * 128 + x!) * 2, true), expected);
	}
	assert.deepEqual(RAW_RECOVERY_HIGHLIGHT_RED, [2217, 2620, 3023, 3426]);
});

test('Actual ABI 2 exposes only the fixed recovery interface and rejects invalid native states/modes/bounds', async () => {
	const n = await native();
	try {
		assert.notEqual(n.api.raw_open(), 0); assert.notEqual(n.api.raw_decode(1), 0); assert.equal(n.api.raw_output_ptr(), 0);
		assert.equal(n.api.raw_input_alloc(0), 0); assert.equal(n.api.raw_input_alloc(64 * 1024 * 1024 + 1), 0);
		for (const mode of [0, 2, 4, -1]) {
			n.api.raw_destroy(); open(n.api, rawRecoveryDngFixtureV1().bytes); assert.notEqual(n.api.raw_decode(mode), 0); assert.equal(n.api.raw_output_ptr(), 0);
		}
		for (const mode of [1, 3]) {
			n.api.raw_destroy(); open(n.api, rawRecoveryDngFixtureV1().bytes); assert.equal(n.api.raw_decode(mode), 0);
			assert.equal(n.api.raw_highlight_mode(), mode); assert.ok(n.api.raw_exposure_scale() > 1); rgb(n.api, 128, 96);
			assert.notEqual(n.api.raw_decode(mode), 0);
		}
	} finally { n.close(); }
});

test('Actual H3 reconstructs ordered clipped-channel detail against identically normalized H1 and unchanged controls', async () => {
	const fixture = rawRecoveryDngFixtureV1(), before = hash(fixture.bytes), module = await loadModule();
	const headroom = decodeLibRawRecoveryWasmV2(module, fixture.bytes, 'linear-headroom-v1');
	const recovered = decodeLibRawRecoveryWasmV2(module, fixture.bytes, 'highlight-recovery-v1');
	try {
		checkFrame(headroom, RAW_RECOVERY_WIDTH, RAW_RECOVERY_HEIGHT); checkFrame(recovered, 128, 96);
		assert.equal(headroom.profile, PROFILES[0]); assert.equal(recovered.profile, PROFILES[1]); assert.equal(recovered.rawFlip, 0);
		assertRecoveryEvidence(headroom, recovered); assert.equal(hash(fixture.bytes), before);
		assert.ok(RAW_RECOVERY_ROIS.highlights.every(roi => mean(recovered, roi, 0) > 1), 'Unclipped output must retain source headroom.');
		// Countermodel: a global gain is not accepted as recovery. This deliberately
		// counterfeit result never enters a production decoder or pixel provider.
		const boosted = { ...headroom, frame: { ...headroom.frame, pixels: headroom.frame.pixels.map(value => value * 1.5) } };
		try { assert.throws(() => assertRecoveryEvidence(headroom, boosted)); } finally { boosted.frame.pixels.fill(0); }
	} finally { wipe(headroom, recovered); }
});

test('Actual headroom normalization preserves ABI 1 midtone brightness within declared integer truncation tolerance', async () => {
	const fixture = rawRecoveryDngFixtureV1(), module = await loadModule();
	const recovery = decodeLibRawRecoveryWasmV2(module, fixture.bytes, 'linear-headroom-v1');
	const legacyModule = await WebAssembly.compile(new Uint8Array(await readFile(new URL('runtime-assets/libraw/0.22.2/libraw.wasm', ROOT))));
	const legacy = decodeLibRawOriginalWasmV1(legacyModule, fixture.bytes);
	try {
		const roi = RAW_RECOVERY_ROIS.midtone;
		for (let y = roi.y; y < roi.y + roi.height; y++) for (let x = roi.x; x < roi.x + roi.width; x++) for (let channel = 0; channel < 3; channel++) {
			const at = (y * 128 + x) * 4 + channel;
			assert.ok(Math.abs(recovery.frame.pixels[at]! - legacy.frame.pixels[at]! / 65535) < 8 / 65535,
				'Flat-field H0/H1 may differ by bounded ushort scaling/color-matrix truncation, not a WB-dependent exposure change.');
		}
	} finally { wipe(recovery); legacy.frame.pixels.fill(0); }
});

test('Actual Float32 matrix capture preserves negative color, HDR values and values outside the RGB16 lattice', async () => {
	const module = await loadModule(), canary = decodeLibRawRecoveryWasmV2(module,
		rawRecoveryDngFixtureV1({ variant: 'color-canary' }).bytes, 'linear-headroom-v1');
	const bright = decodeLibRawRecoveryWasmV2(module, rawRecoveryDngFixtureV1().bytes, 'linear-headroom-v1');
	try {
		checkFrame(canary, 128, 96); assert.ok(mean(canary, RAW_RECOVERY_ROIS.canary, 0) < -0.05, 'Unmixing the declared camera matrix must retain signed red.');
		assert.ok(mean(bright, RAW_RECOVERY_ROIS.highlights[3]!, 0) > 1.5);
		let subword = 0;
		for (let at = 0; at < canary.frame.pixels.length; at += 4) for (let channel = 0; channel < 3; channel++) {
			const word = canary.frame.pixels[at + channel]! * 65535;
			if (Math.abs(word - Math.round(word)) > 0.05) subword++;
		}
		assert.ok(subword > 1000, 'Native matrix precision cannot be a ushort RGB result cast to Float32.');
	} finally { wipe(canary, bright); }
});

test('Actual ABI 2 retains full extents including incomplete recovery cells and owns/wipes native payloads', async () => {
	const n = await native(), fixture = rawRecoveryDngFixtureV1({ width: 130, height: 98 }), before = fixture.bytes.slice();
	try {
		const input = open(n.api, fixture.bytes); assert.equal(n.api.raw_decode(3), 0); const values = rgb(n.api, 130, 98);
		assert.ok(values.every(Number.isFinite)); assert.ok(values[(97 * 130 + 129) * 3]! > 0);
		const output = n.api.raw_output_ptr(), length = n.api.raw_output_bytes(); assert.deepEqual(new Uint8Array(n.api.memory.buffer, input, before.length), before);
		n.api.raw_destroy(); assert.equal(n.api.raw_output_ptr(), 0); assert.equal(n.api.raw_output_bytes(), 0);
		// Allocator bookkeeping can rewrite freed leading words; check payload
		// interiors before the outer scope independently erases the whole heap.
		assert.ok(new Uint8Array(n.api.memory.buffer, input + 64, before.length - 128).every(value => value === 0));
		assert.ok(new Uint8Array(n.api.memory.buffer, output + 64, length - 128).every(value => value === 0)); assert.deepEqual(fixture.bytes, before);
	} finally { n.close(); }
});

test('Actual recovery output applies all eight native orientations directly without changing the encoded Original', async () => {
	const module = await loadModule(), baseline = decodeLibRawRecoveryWasmV2(module, rawRecoveryDngFixtureV1().bytes, 'highlight-recovery-v1');
	const flips = [0, 1, 3, 2, 4, 6, 7, 5] as const;
	try {
		for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const satisfies readonly RawRecoveryOrientationV1[]) {
			const fixture = rawRecoveryDngFixtureV1({ orientation }), before = hash(fixture.bytes), actual = decodeLibRawRecoveryWasmV2(module, fixture.bytes, 'highlight-recovery-v1');
			try {
				const flip = flips[orientation - 1]!, swapped = (flip & 4) !== 0, width = swapped ? 96 : 128, height = swapped ? 128 : 96;
				checkFrame(actual, width, height); assert.equal(actual.rawFlip, flip); assert.equal(actual.exposureScale, baseline.exposureScale);
				for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
					let sourceX = swapped ? y : x, sourceY = swapped ? x : y;
					if (flip & 2) sourceY = 95 - sourceY; if (flip & 1) sourceX = 127 - sourceX;
					for (let channel = 0; channel < 4; channel++) assert.equal(actual.frame.pixels[(y * width + x) * 4 + channel], baseline.frame.pixels[(sourceY * 128 + sourceX) * 4 + channel]);
				}
				assert.equal(hash(fixture.bytes), before);
			} finally { wipe(actual); }
		}
	} finally { wipe(baseline); }
});
