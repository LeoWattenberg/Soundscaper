/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopGpuCurrentV1 } from '../src/common/editor/imaging/image-develop-gpu-current-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-current-v1.ts';
import { prepareImageDevelopGpuPlanCurrentV1 } from '../src/common/editor/imaging/image-develop-gpu-plan-current-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as LIMITS } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';

const effect = (type: string, params: Readonly<Record<string, number>>, id = type) => ({ id, type, enabled: true, params });
const optics = [effect('lens-distortion-v1', { amount: -25 }), effect('chromatic-aberration-v1', { red: -20, blue: 10 }),
	effect('defringe-v1', { purple: 100, green: 50, edgeThreshold: 0 }), effect('optical-vignette-v1', { amount: 50 })];
const state = (effects: readonly unknown[]) => normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects });
const descriptor = (width: number, height: number) => ({ schemaVersion: 1 as const, width, height,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });

test('all four optical families retain authored positions and their incoming natural aperture before pixel access', () => {
	let reads = 0;
	const input = { descriptor: descriptor(6, 2), get pixels() { reads++; throw new Error('pixels'); } };
	const develop = state([effect('develop-geometry-v1', { cropWidth: .5, cropHeight: .5 }), ...optics,
		effect('tone-ladder-v1', { exposure: 1 }), effect('develop-geometry-v1', { rotationDegrees: 90 }, 'turn')]);
	const metadata = prepareLinearDevelopMetadataCurrentV1({ frame: input, develop }, LIMITS, {});
	const plan = prepareImageDevelopGpuPlanCurrentV1(metadata);
	assert.equal(reads, 0); assert.equal(plan.unsupported, false); assert.equal(plan.eligible, true);
	assert.deepEqual(plan.passes.map(pass => pass.kind), [9, 10, 11, 12, 13, 2, 9]);
	for (const pass of plan.passes.slice(1, 5)) {
		assert.ok('sourceDescriptor' in pass); assert.equal(pass.sourceDescriptor.width, 3); assert.equal(pass.sourceDescriptor.height, 1);
	}
	assert.equal(plan.pipeline.referenceBytes, 384); assert.equal(plan.pipeline.textureBytes, 384);
	assert.equal(plan.pipeline.readbackBytes, 48);
	assert.deepEqual([plan.pipeline.finalDescriptor.width, plan.pipeline.finalDescriptor.height], [1, 3]);
});

for (const selected of optics) test(`${selected.type} reaches native context admission and preserves its complete CPU fallback`, async () => {
	const pixels = Float32Array.of(-.125, .25, 2, .5), before = pixels.slice(), input = { descriptor: descriptor(1, 1), pixels };
	let calls = 0;
	const actual = await withImageDevelopGpuCurrentV1({ frame: input, develop: state([selected]) }, (result, execution) => {
		calls++; assert.equal(execution.backend, 'cpu'); assert.match(execution.reason!, /canvas|context|float-target/u);
		return [...result.pixels];
	}, LIMITS);
	assert.deepEqual(actual, [...pixels]); assert.deepEqual(pixels, before); assert.equal(calls, 1);
});

test('an active mask still selects the entire CPU recipe beside admitted optical and spatial families', async () => {
	const pixels = Float32Array.of(.125, .25, .5, 1);
	await withImageDevelopGpuCurrentV1({ frame: { descriptor: descriptor(1, 1), pixels },
		develop: normalizeImageDevelopStateCurrentV1({ ...state([...optics, effect('texture-v1', { amount: 25 })]),
			masks: [{ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [{ id: 'rect', kind: 'vector-shape',
				shape: 'rectangle', x: 0, y: 0, width: .5, height: 1 }], outputNodeId: 'rect' }], maskBindings: [{ maskId: 'local', effectId: 'texture-v1' }],
		}) }, (_result, execution) => {
		assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'unsupported-stage');
	}, LIMITS);
});

test('invalid optical metadata refuses before pixels beside spatial stages', async () => {
	let reads = 0;
	await assert.rejects(withImageDevelopGpuCurrentV1({ frame: { descriptor: descriptor(1, 1), get pixels() { reads++; throw new Error('pixels'); } },
		develop: { ...defaultImageDevelopStateV2(), effects: [effect('lens-distortion-v1', { amount: 101 }), effect('texture-v1', { amount: 25 })] } },
	() => undefined, LIMITS), /-100|100|distortion/u);
	assert.equal(reads, 0);
});

test('optics, geometry and LUT fallback use one captured Original across resource awaits and retain complete authored order', async () => {
	const text = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1', parsed = parseCubeLutV1(text), bytes = new TextEncoder().encode(text);
	const reference = { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256, byteLength: parsed.byteLength,
		size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax };
	const develop = state([effect('develop-geometry-v1', { cropWidth: .5 }), ...optics,
		{ id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference } }, effect('develop-geometry-v1', { rotationDegrees: 90 }, 'turn')]);
	const pixels = Float32Array.of(.125, .25, .75, 1, .5, .125, .25, .5, -.125, .75, .5, 1, .25, .5, 1, .25);
	const input = { descriptor: descriptor(4, 1), pixels }, original = pixels.slice();
	const immediate: CubeLutSourcePortV1 = { withBytes(_ref, consume) { return Promise.resolve(consume(bytes)); } };
	const expected = await withImageDevelopLinearCurrentV1({ frame: { ...input, pixels: original }, develop }, frame => [...frame.pixels], LIMITS, { source: immediate });
	let release!: () => void, reads = 0, calls = 0;
	const held = new Promise<void>(resolve => { release = resolve; });
	const source: CubeLutSourcePortV1 = { async withBytes(_ref, consume) { if (++reads === 1) await held; return consume(bytes); } };
	const pending = withImageDevelopGpuCurrentV1({ frame: input, develop }, (frame, execution) => {
		calls++; return { pixels: [...frame.pixels], reason: execution.reason, width: frame.descriptor.width, height: frame.descriptor.height };
	}, LIMITS, { source });
	const readsBeforeMutation = reads; pixels.fill(1); release(); const actual = await pending;
	assert.equal(readsBeforeMutation, 1); assert.notEqual(actual.reason, 'unsupported-stage'); assert.deepEqual([actual.width, actual.height], [1, 2]);
	assert.deepEqual(actual.pixels, expected); assert.equal(reads, 2); assert.equal(calls, 1);
});
