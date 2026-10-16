/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2LutCurrentV1, planPixelFrameWebGl2LutsCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-lut-current-v1.ts';
import { planPixelFrameWebGl2CurrentV1, withPixelFrameWebGl2CurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-current-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';

const MiB = 1024 * 1024;
function pass(size = 2) {
	return preparePixelFrameWebGl2LutCurrentV1({ id: 'lut', reference: { storageKey: `lut-sha256:${'1'.repeat(64)}`,
		sha256: '1'.repeat(64), byteLength: 128, size, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } });
}
function descriptor(width = 1, height = 1) {
	return { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm16' as const, primaries: 'srgb' as const, transfer: 'linear' as const };
}
const source: CubeLutSourcePortV1 = { withBytes() { return Promise.reject(new Error('No metadata plan may read a body.')); } };

test('LUT scalar admission charges exact Double oracle, reusable upload and persistent 3D texture before pixels or I/O', () => {
	const lut = pass(), resources = planPixelFrameWebGl2LutsCurrentV1([lut]); let reads = 0;
	const plan = planPixelFrameWebGl2CurrentV1({ frame: { descriptor: descriptor(), get pixels() { reads++; throw new Error('pixels'); } },
		passes: [lut], lutSource: source });
	assert.equal(resources.oracleBytes, 8 * 3 * 8); assert.equal(resources.uploadBytes, 8 * 4 * 4); assert.equal(resources.textureBytes, 8 * 4 * 4);
	assert.equal(plan.uniformBytes, 4096); assert.equal(plan.gpuWorkingBytes, 8 + 4 * 16 + 4096 + 192 + 128 + 128);
	assert.equal(plan.peakWorkingBytes, 8 + 16 + resources.capturePeakBytes); assert.equal(plan.eligible, true); assert.equal(reads, 0);
});

test('LUT source authority is required during scalar admission, before touching a native source view', () => {
	let reads = 0; const input = { frame: { descriptor: descriptor(), get pixels() { reads++; throw new Error('pixels'); } }, passes: [pass()] };
	assert.throws(() => planPixelFrameWebGl2CurrentV1(input), /source|LUT/u); assert.equal(reads, 0);
});

test('padded physical Original plus LUT execution storage selects captured-source fallback before body or GL allocation', async () => {
	const width = 2048, backing = new ArrayBuffer(506 * MiB), pixels = new Uint16Array(backing, 0, width * width * 4);
	pixels[0] = 32768; pixels[3] = 65535;
	let reads = 0, calls = 0, captured: ArrayBuffer | undefined;
	const source: CubeLutSourcePortV1 = { withBytes() { reads++; return Promise.reject(new Error('GPU resource phase must not start.')); } };
	const result = await withPixelFrameWebGl2CurrentV1({ frame: { descriptor: descriptor(width, width), pixels }, passes: [pass(65)], lutSource: source }, view => {
		calls++; assert.equal(view.backend, 'cpu'); if (view.backend !== 'cpu') throw new Error('CPU fallback required.');
		assert.equal(view.reason, 'working-set'); captured = view.source.pixels.buffer;
		return [view.source.pixels[0], view.source.pixels[3]];
	});
	assert.deepEqual(result, [Math.fround(32768 / 65535), 1]); assert.equal(calls, 1); assert.equal(reads, 0);
	assert.ok(captured); assert.equal(new Uint8Array(captured).every(n => n === 0), true); assert.equal(pixels[0], 32768);
});
