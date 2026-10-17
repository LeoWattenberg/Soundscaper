/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeLinearManagedGradeV1, LINEAR_LUT_TRANSIENT_RESERVE_BYTES_V1 } from '../src/common/editor/imaging/pixel-frame-linear-lut-v1.ts';
import { normalizeVideoColorGradeV1 } from '../src/common/editor/video-color-management-v27.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { withCubeLutPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-cube-lut-v1.ts';
const IDENTITY = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1';
const SWAP = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
function descriptor(width: number, height = 1) { return { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const }; }
function resource(text = IDENTITY) {
	const body = parseCubeLutV1(text);
	return { bytes: new TextEncoder().encode(text), reference: { storageKey: `lut-sha256:${body.sha256}`, sha256: body.sha256,
		byteLength: body.byteLength, size: body.size, domainMin: body.domainMin, domainMax: body.domainMax } };
}
async function run(source: Float32Array<ArrayBuffer>, changes: Record<string, unknown> = {}, text?: string) {
	const selected = text === undefined ? undefined : resource(text), before = source.slice(), target = new Float32Array(source.length);
	await writeLinearManagedGradeV1(normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), ...changes, lut: selected?.reference ?? null }),
		descriptor(source.length / 4), source, target, selected?.bytes);
	assert.deepEqual(source, before); return target;
}
function close(actual: number, expected: number): void { assert.ok(Math.abs(actual - expected) <= 2e-6 * Math.max(1, Math.abs(expected)), `${String(actual)} != ${String(expected)}`); }

test('linear managed grade has exact neutral identity and exposure inversion for signed HDR/tiny samples without LUT', async () => {
	const source = new Float32Array([-4, 2 ** -149, 2 ** -100, 0.375, 2, -0.25, 0.125, 0]);
	assert.deepEqual(await run(source), source);
	const exposed = await run(source, { exposureStops: 1 }); assert.deepEqual(exposed.slice(0, 4), new Float32Array([-8, 2 ** -148, 2 ** -99, 0.375]));
	assert.deepEqual(await run(exposed, { exposureStops: -1 }), source);
});

test('native grade applies stable affine contrast, signed LGG and Rec709 saturation in authored order', async () => {
	const source = new Float32Array([-1, 0.25, 2, 0.5]);
	const output = await run(source, { exposureStops: 1, contrast: 0.5, lift: [0.16, -0.09, 0], gain: [2, 1, 1], gamma: [2, 1, 1] });
	// Affine contrast gives[-.91,.34,2.09], lift/gain gives[-1.5,.25,2.09].
	close(output[0]!, -Math.sqrt(1.5)); close(output[1]!, 0.25); close(output[2]!, 2.09); assert.equal(output[3], 0.5);
	const gray = await run(new Float32Array([1, 0, 0, 1]), { saturation: 0 });
	for (const value of gray.slice(0, 3)) close(value, 0.2126);
});

test('actual digest-authenticated red-fastest cube samples native sub-byte values and preserves every alpha', async () => {
	const source = new Float32Array([1024 / 65535, 1025 / 65535, 0.375, 0, 0.125, 0.5, 0.875, 0.375]);
	assert.deepEqual(await run(source, {}, IDENTITY), source);
	assert.deepEqual(await run(source, {}, SWAP), new Float32Array([0.375, 1025 / 65535, 1024 / 65535, 0, 0.875, 0.5, 0.125, 0.375]));
});

test('LUT declares its own domain clamp while its interpolated signed/HDR outputs remain unclipped', async () => {
	const text = 'LUT_3D_SIZE 2\nDOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\n-2 0 3\n2 0 3\n-2 1 3\n2 1 3\n-2 0 5\n2 0 5\n-2 1 5\n2 1 5';
	const output = await run(new Float32Array([0.25, -0.5, 2, 0.25]), {}, text);
	assert.deepEqual(output, new Float32Array([0.5, 0.25, 5, 0.25]));
	const graded = await run(new Float32Array([0.125, 0.25, 0.375, 1]), { exposureStops: 1 }, SWAP);
	assert.deepEqual(graded, new Float32Array([0.75, 0.5, 0.25, 1]));
});

test('existing byte LUT output is unchanged and matches explicit final presentation of the native grade', async () => {
	const selected = resource(SWAP), values = [32, 64, 128, 73, 200, 160, 100, 0];
	const decode = (value: number) => { const n = value / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
	const source = new Float32Array(values.map((value, index) => index % 4 === 3 ? value / 255 : decode(value)));
	const output = await run(source, { exposureStops: 0.5 }, SWAP);
	const grade = normalizeVideoColorGradeV1({ ...normalizeVideoColorGradeV1(), exposureStops: 0.5, lut: selected.reference });
	const baseline = await withCubeLutPixelFrameV1({ frame: { descriptor: { ...descriptor(2), sampleFormat: 'unorm8', transfer: 'srgb' }, pixels: new Uint8Array(values) }, grade, bytes: selected.bytes }, frame => [...frame.pixels],
		{ limits: { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 } });
	for (let index = 0; index < output.length; index++) {
		const n = output[index]!, encoded = index % 4 === 3 ? n : n <= 0.0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - 0.055;
		assert.ok(Math.abs(Math.floor(Math.max(0, Math.min(1, encoded)) * 255 + 0.5) - baseline[index]!) <= 1);
	}
});

test('full resource authentication precedes target writes, including digest/body/geometry mismatch and pre-abort', async () => {
	assert.equal(LINEAR_LUT_TRANSIENT_RESERVE_BYTES_V1, 128 * 1024 * 1024);
	const selected = resource(), source = new Float32Array([0.25, 0.5, 0.75, 1]);
	for (const [reference, bytes] of [[{ ...selected.reference, sha256: '0'.repeat(64), storageKey: `lut-sha256:${'0'.repeat(64)}` }, selected.bytes],
		[selected.reference, new TextEncoder().encode(SWAP)], [{ ...selected.reference, size: 3 }, selected.bytes]] as const) {
		const target = new Float32Array(4).fill(19);
		await assert.rejects(writeLinearManagedGradeV1({ ...normalizeVideoColorGradeV1(), lut: reference }, descriptor(1), source, target, bytes));
		assert.deepEqual([...target], [19, 19, 19, 19]);
	}
	const controller = new AbortController(), reason = Object.create(null) as object; controller.abort(reason);
	let reads = 0; const hostile = new Proxy({}, { getPrototypeOf() { reads++; throw new Error('reflected'); } });
	try { await writeLinearManagedGradeV1(hostile, hostile, source, new Float32Array(4), selected.bytes, controller.signal); assert.fail('pre-abort'); }
	catch (error) { assert.equal(error, reason); } assert.equal(reads, 0);
});

test('native LUT loops yield to opaque cancellation, detect detach and never mutate the borrowed immutable cube bytes', async () => {
	const selected = resource(SWAP), before = selected.bytes.slice(), source = new Float32Array(128 * 128 * 4).fill(0.25), target = new Float32Array(source.length);
	for (let index = 3; index < source.length; index += 4) source[index] = 1;
	const controller = new AbortController(), reason = Object.create(null) as object;
	setTimeout(() => { controller.abort(reason); }, 0);
	try { await writeLinearManagedGradeV1({ ...normalizeVideoColorGradeV1(), lut: selected.reference }, descriptor(128, 128), source, target, selected.bytes, controller.signal); assert.fail('expected cancellation'); }
	catch (error) { assert.equal(error, reason); }
	assert.deepEqual(selected.bytes, before);
});
