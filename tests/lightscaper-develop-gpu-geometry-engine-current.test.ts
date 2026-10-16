/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopGpuCurrentV1 } from '../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';

const state = (effects: readonly unknown[], geometry = defaultImageDevelopStateV2().geometry) =>
	normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects, geometry });
const transform = (id: string, params: Readonly<Record<string, number>>) => ({ id, type: 'develop-geometry-v1', enabled: true, params });
const exposure = (id: string, amount: number) => ({ id, type: 'tone-ladder-v1', enabled: true, params: { exposure: amount } });
function frame(width: number, height: number, pixels: Float32Array<ArrayBuffer>) {
	return { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const,
		primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
}
function lattice() {
	const text = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
	const body = parseCubeLutV1(text), bytes = new TextEncoder().encode(text);
	const reference = { storageKey: `lut-sha256:${body.sha256}`, sha256: body.sha256, byteLength: body.byteLength,
		size: body.size, domainMin: body.domainMin, domainMax: body.domainMax };
	return { bytes, effect: { id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference } } };
}

test('native geometry reaches actual context admission, then delivers the final natural CPU extent exactly once', async () => {
	const pixels = Float32Array.from([1, 2, 3, 4, 5, 6].flatMap(value => [value, value + .125, -value, 1]));
	const input = frame(3, 2, pixels), before = pixels.slice(); let calls = 0;
	const output = await withImageDevelopGpuCurrentV1({ frame: input, develop: state([transform('turn', { rotationDegrees: 90 })]) }, (result, execution) => {
		calls++; assert.equal(execution.backend, 'cpu'); assert.match(execution.reason!, /canvas|context|float-target/u);
		return { width: result.descriptor.width, height: result.descriptor.height, pixels: [...result.pixels] };
	}, PHOTO_DEVELOP_LINEAR_LIMITS_V1);
	assert.equal(calls, 1); assert.deepEqual([output.width, output.height], [2, 3]);
	assert.deepEqual(output.pixels, [4, 1, 5, 2, 6, 3].flatMap(value => [value, value + .125, -value, 1]));
	assert.deepEqual(pixels, before);
});

test('authored identity geometry clears hidden RGB and canonicalizes zero instead of disappearing as neutral', async () => {
	const input = frame(1, 2, Float32Array.of(-2, 4, 8, 0, -0, 0, -0, 1));
	const output = await withImageDevelopGpuCurrentV1({ frame: input, develop: state([transform('identity', {})]) }, (result, execution) => {
		assert.notEqual(execution.reason, 'unsupported-stage'); return [...result.pixels];
	}, PHOTO_DEVELOP_LINEAR_LIMITS_V1);
	assert.deepEqual(output, [0, 0, 0, 0, 0, 0, 0, 1]);
});

test('legacy crop, authored exposure, rotation, verified LUT and suffix exposure preserve their complete order', async () => {
	const selected = lattice(); let reads = 0;
	const source: CubeLutSourcePortV1 = { withBytes(_reference, consume) { reads++; return Promise.resolve(consume(selected.bytes)); } };
	const pixels = Float32Array.from([.125, .25, .5, .75, .875, 1, 1.5, 2].flatMap(red => [red, .125, .5, 1]));
	const effects = [exposure('before', 1), transform('turn', { rotationDegrees: 90 }), selected.effect, exposure('after', -1)];
	const geometry = { ...defaultImageDevelopStateV2().geometry, crop: { x: .25, y: 0, width: .5, height: 1 } };
	const output = await withImageDevelopGpuCurrentV1({ frame: frame(4, 2, pixels), develop: state(effects, geometry) }, (result, execution) => {
		assert.notEqual(execution.reason, 'unsupported-stage'); return [...result.pixels];
	}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source });
	assert.deepEqual(output, [.5, .125, .5, 1, .5, .125, .25, 1, .5, .125, .5, 1, .5, .125, .5, 1]);
	assert.equal(reads, 2);
});

test('complete geometry and LUT authority refuse before any native pixel accessor or body read', async () => {
	let reads = 0, bodyReads = 0; const selected = lattice();
	const input = { descriptor: frame(1, 1, new Float32Array(4)).descriptor, get pixels() { reads++; throw new Error('pixels'); } };
	const source: CubeLutSourcePortV1 = { withBytes() { bodyReads++; return Promise.reject(new Error('body')); } };
	await assert.rejects(withImageDevelopGpuCurrentV1({ frame: input, develop: { ...defaultImageDevelopStateV2(), effects: [transform('bad', { cropX: .9, cropWidth: .5 })] } }, () => undefined,
		PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source }), /crop/u);
	await assert.rejects(withImageDevelopGpuCurrentV1({ frame: input, develop: state([transform('turn', { rotationDegrees: 90 }), selected.effect]) }, () => undefined,
		PHOTO_DEVELOP_LINEAR_LIMITS_V1), /source|LUT/u);
	assert.equal(reads, 0); assert.equal(bodyReads, 0);
});

test('geometry and LUT execution capture the Original before resource awaits and never reopen mutable samples', async () => {
	const selected = lattice(); let release!: () => void, reads = 0, calls = 0;
	const held = new Promise<void>(resolve => { release = resolve; });
	const source: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { if (++reads === 1) await held; return consume(selected.bytes); } };
	const pixels = Float32Array.of(.125, .25, .75, 1, .5, .125, .25, .5), input = frame(2, 1, pixels);
	const pending = withImageDevelopGpuCurrentV1({ frame: input, develop: state([transform('turn', { rotationDegrees: 90 }), selected.effect]) }, (result, execution) => {
		calls++; assert.notEqual(execution.reason, 'unsupported-stage'); return { width: result.descriptor.width, height: result.descriptor.height, pixels: [...result.pixels] };
	}, PHOTO_DEVELOP_LINEAR_LIMITS_V1, { source });
	assert.equal(reads, 1); pixels.fill(1); release();
	assert.deepEqual(await pending, { width: 1, height: 2, pixels: [.75, .25, .125, 1, .25, .125, .5, .5] });
	assert.equal(reads, 2); assert.equal(calls, 1);
});
