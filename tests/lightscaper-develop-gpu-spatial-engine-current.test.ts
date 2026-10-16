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

const effect = (type: string, params: Readonly<Record<string, number>>, id = type) => ({ id, type, enabled: true, params });
const spatial = [effect('detail-sharpen-v1', { amount: 50, threshold: 0 }), effect('post-crop-vignette-v1', { amount: -25 }),
	effect('clarity-v1', { amount: 25 }), effect('noise-reduction-v1', { luminance: 50, color: 50 }),
	effect('grain-v1', { amount: 25, seed: 23 }), effect('texture-v1', { amount: -25 }), effect('dehaze-v1', { amount: -25 })];
const state = (effects: readonly unknown[]) => normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects });
const descriptor = (width: number, height: number) => ({ schemaVersion: 1 as const, width, height,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
const mask = { schemaVersion: 1, id: 'local', kind: 'mask', inputs: [],
	nodes: [{ id: 'rect', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: .5, height: 1 }], outputNodeId: 'rect' };

test('all seven spatial families retain authored order and natural aperture without reading source pixels', () => {
	let reads = 0;
	const frame = { descriptor: descriptor(6, 2), get pixels() { reads++; throw new Error('pixels'); } };
	const develop = state([effect('develop-geometry-v1', { cropWidth: .5, cropHeight: .5 }), ...spatial,
		effect('tone-ladder-v1', { exposure: 1 }), effect('develop-geometry-v1', { rotationDegrees: 90 }, 'turn')]);
	const plan = prepareImageDevelopGpuPlanCurrentV1(prepareLinearDevelopMetadataCurrentV1({ frame, develop }, LIMITS, {}));
	assert.equal(reads, 0); assert.equal(plan.unsupported, false); assert.equal(plan.eligible, true);
	assert.deepEqual(plan.passes.map(pass => pass.kind), [9, 14, 15, 16, 17, 18, 19, 20, 2, 9]);
	for (const pass of plan.passes.slice(1, 8)) {
		assert.ok('sourceDescriptor' in pass); assert.equal(pass.sourceDescriptor.width, 3); assert.equal(pass.sourceDescriptor.height, 1);
	}
	assert.equal(plan.pipeline.hasSpatial, true); assert.equal(plan.pipeline.hasOptics, false);
	assert.equal(plan.pipeline.referenceBytes, 384); assert.equal(plan.pipeline.textureBytes, 384); assert.equal(plan.pipeline.readbackBytes, 48);
	assert.deepEqual([plan.pipeline.finalDescriptor.width, plan.pipeline.finalDescriptor.height], [1, 3]);
});

for (const selected of spatial) test(`${selected.type} reaches native admission and retains complete CPU fallback and retirement`, async () => {
	const pixels = Float32Array.of(-.125, .25, 2, .5, .125, .5, .25, 1, .25, .125, .5, .25), before = pixels.slice();
	const frame = { descriptor: descriptor(3, 1), pixels }, develop = state([selected]);
	const expected = await withImageDevelopLinearCurrentV1({ frame, develop }, result => [...result.pixels], LIMITS);
	let calls = 0, borrowed: Float32Array<ArrayBuffer> | undefined;
	const actual = await withImageDevelopGpuCurrentV1({ frame, develop }, (result, execution) => {
		calls++; borrowed = result.pixels; assert.equal(execution.backend, 'cpu'); assert.match(execution.reason!, /canvas|context|float-target/u);
		return [...result.pixels];
	}, LIMITS);
	assert.deepEqual(actual, expected); assert.deepEqual(pixels, before); assert.equal(calls, 1); assert.ok(borrowed?.every(n => n === 0));
});

test('a bound spatial effect reaches native admission and retains complete CPU masks when no canvas exists', async () => {
	const pixels = Float32Array.of(.125, .25, .5, 1, .25, .5, .125, .5, .5, .125, .25, 1), before = pixels.slice();
	const frame = { descriptor: descriptor(3, 1), pixels }, develop = normalizeImageDevelopStateCurrentV1({
		...state(spatial), masks: [mask], maskBindings: [{ maskId: 'local', effectId: 'texture-v1' }],
	});
	const expected = await withImageDevelopLinearCurrentV1({ frame, develop }, result => [...result.pixels], LIMITS);
	await withImageDevelopGpuCurrentV1({ frame, develop }, (result, execution) => {
		assert.equal(execution.backend, 'cpu'); assert.equal(execution.reason, 'canvas-unavailable'); assert.deepEqual([...result.pixels], expected);
	}, LIMITS);
	assert.deepEqual(pixels, before);
});

test('disabled and Q8-neutral spatial metadata is retained as copy passes without creating an unsupported recipe', () => {
	const values = spatial.map((value, at) => at % 2 ? { ...value, enabled: false } : { ...value, params: { amount: .1 } });
	const plan = prepareImageDevelopGpuPlanCurrentV1(prepareLinearDevelopMetadataCurrentV1({ frame: { descriptor: descriptor(2, 1) }, develop: state(values) }, LIMITS, {}));
	assert.equal(plan.unsupported, false); assert.equal(plan.passes.length, 7);
	for (const pass of plan.passes) { assert.ok('inputPolicy' in pass); assert.equal(pass.inputPolicy, 'copy'); assert.equal(pass.params1[3], 0); }
});

test('invalid disabled spatial metadata refuses before source samples even beside an unsupported mask', async () => {
	let reads = 0;
	await assert.rejects(withImageDevelopGpuCurrentV1({ frame: { descriptor: descriptor(1, 1), get pixels() { reads++; throw new Error('pixels'); } },
		develop: { ...defaultImageDevelopStateV2(), effects: [{ ...effect('grain-v1', { seed: .25 }), enabled: false }],
			masks: [mask], maskBindings: [{ maskId: 'local', effectId: 'grain-v1' }] } }, () => undefined, LIMITS));
	assert.equal(reads, 0);
});
