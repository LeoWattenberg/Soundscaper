/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 as prepare, readPixelFrameWebGl2MaskPlanCurrentV1 as read,
	isPixelFrameWebGl2MaskPlanCurrentV1 as isPlan, readPixelFrameWebGl2MaskCheckpointPlanCurrentV1 as readCheckpoints } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1 as metadataFor, prepareDevelopProxyMetadataCurrentV1 as proxyMetadataFor } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { prepareImageDevelopGpuPlanCurrentV1 as gpuFor } from '../src/common/editor/imaging/image-develop-gpu-plan-current-v1.ts';
import { readPixelFrameWebGl2PassCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-pass-current-v1.ts';
import { imageDevelopMaskTransformsCurrentV1 } from '../src/common/editor/imaging/image-develop-mask-plan-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const BASE = defaultImageDevelopStateV2();
const LUT_BODY = new TextEncoder().encode(`LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => '.25 0 0').join('\n')}`);
const LUT_SHA = createHash('sha256').update(LUT_BODY).digest('hex');
const LUT = Object.freeze({ storageKey: `lut-sha256:${LUT_SHA}`, sha256: LUT_SHA, byteLength: LUT_BODY.length, size: 2,
	domainMin: Object.freeze([0, 0, 0]), domainMax: Object.freeze([1, 1, 1]) });
const frame = (width = 8, height = 6) => ({ descriptor: { schemaVersion: 1 as const, width, height,
	sampleFormat: 'float32' as const, transfer: 'linear' as const, primaries: 'srgb' as const },
	get pixels(): never { return assert.fail('Checkpoint planning may not inspect source samples.'); } });
const effect = (type: string, id: string, params: Readonly<Record<string, number>> = {}, enabled = true) => createVideoEffect(type, { id, params, enabled });
const graph = { schemaVersion: 2, id: 'shared', name: 'Shared graph', kind: 'matte', inputs: [],
	nodes: [{ id: 'range', kind: 'luminance-range', lower: .1, upper: .5, falloff: .1 }], outputNodeId: 'range' };
function metadata(effects: readonly unknown[], bound: readonly string[] = [], selected?: string, width = 8, height = 6) {
	return metadataFor({ frame: frame(width, height), develop: { ...BASE, effects,
		masks: bound.length ? [graph] : [], maskBindings: bound.map(effectId => ({ maskId: 'shared', effectId })) },
		...(selected ? { maskOverlay: { maskId: 'shared', effectId: selected } } : {}) }, PROFILE, {});
}
const extent = (value: Readonly<{ width: number; height: number }>) => [value.width, value.height];

test('private mask pipeline retains authored slots across reduced colors, disabled geometry and extent changes', () => {
	const effects = [effect('white-balance-v1', 'white-neutral'), effect('develop-geometry-v1', 'off', { rotationDegrees: 45 }, false),
		effect('tone-ladder-v1', 'tone-first', { exposure: 1 }), effect('develop-geometry-v1', 'crop', { cropWidth: .5 }),
		effect('tone-ladder-v1', 'tone-disabled', { exposure: 2 }, false), effect('lens-distortion-v1', 'actual-lens', { amount: 25 }),
		effect('develop-geometry-v1', 'identity'), effect('tone-ladder-v1', 'tone-last', { exposure: -1 })];
	const source = metadataFor({ frame: frame(), develop: { ...BASE, effects,
		geometry: { ...BASE.geometry, crop: { x: .25, y: 0, width: .5, height: 1 } } } }, PROFILE, {}), plan = prepare(source);
	assert.equal(read(plan), plan); assert.equal(isPlan(plan), true); assert.equal(plan.slots.length, 9);
	assert.equal(readCheckpoints(plan).metadata, source); assert.equal(readCheckpoints(plan).authored.slots, source.authoredSlots);
	assert.deepEqual(plan.slots.map(slot => slot.candidateRequired), [true, false, false, true, true, false, true, true, true]);
	assert.deepEqual(plan.passes.map(pass => pass.kind), [9, 2, 9, 10, 9, 2]);
	const lens = plan.slots[6]!.pass; assert.ok(lens && 'id' in lens); assert.equal(lens.kind, 10); assert.equal(lens.id, 'actual-lens');
	for (const slot of plan.slots) {
		assert.equal(slot.authored, source.authoredSlots[slot.ordinal]); assert.equal(slot.incoming, slot.authored.incoming);
		assert.equal(slot.output, slot.authored.output); assert.equal(slot.stageIndex, slot.authored.stageIndex); if (slot.pass) assert.equal(readPixelFrameWebGl2PassCurrentV1(slot.pass), slot.pass);
	}
	assert.deepEqual(plan.slots.map(slot => extent(slot.incoming)), [[8, 6], [4, 6], [4, 6], [4, 6], [4, 6], [2, 6], [2, 6], [2, 6], [2, 6]]);
	assert.equal(plan.slots[2]!.pass, undefined); assert.equal(plan.slots[2]!.authored.stageIndex, null);
	assert.equal(plan.sourceDescriptor, source.descriptor); assert.equal(plan.finalDescriptor, source.finalDescriptor);
	assert.equal(plan.maximumFrameBytes, 8 * 6 * 16); assert.equal(plan.imageTextureCount, 2);
	assert.equal(plan.graphAdmissionComplete, true); assert.equal(plan.graphGpuBytes, 0);
});

test('complete checkpoint order distinguishes declared-only, selected disabled observe, active blend and selected neutral observe', () => {
	const effects = [effect('tone-ladder-v1', 'inactive-unselected', {}, false), effect('tone-ladder-v1', 'inactive-selected', {}, false),
		effect('tone-ladder-v1', 'active', { exposure: 1 }), effect('develop-geometry-v1', 'crop', { cropWidth: .5 }),
		effect('tone-ladder-v1', 'neutral')];
	for (const selected of ['inactive-selected', 'neutral']) {
		const source = metadata(effects, ['inactive-unselected', 'inactive-selected', 'active', 'neutral'], selected), plan = prepare(source);
		assert.deepEqual(plan.checkpoints.map(checkpoint => checkpoint.mode), selected === 'neutral'
			? ['declared-only', 'declared-only', 'blend', 'observe'] : ['declared-only', 'observe', 'blend', 'declared-only']);
		assert.deepEqual(plan.checkpoints.map(checkpoint => checkpoint.index), [0, 1, 2, 3]);
		assert.equal(plan.checkpoints[plan.selectedCheckpointIndex!]!.binding, source.selectedBinding);
		assert.equal(plan.imageTextureCount, 3); assert.equal(plan.referenceBytes, 8 * 6 * 16 * 2);
		assert.equal(plan.graphAdmissionComplete, false); assert.equal(plan.graphGpuBytes, null);
		assert.equal(plan.knownMaskComponentBytes, source.masks.peakWorkingBytes);
		for (const checkpoint of plan.checkpoints) {
			assert.equal(checkpoint.binding, source.masks.plan.bindings.find(binding => binding.effectId === checkpoint.binding.effectId));
			assert.equal(checkpoint.suffix, imageDevelopMaskTransformsCurrentV1(checkpoint.binding));
			assert.equal(plan.slots[checkpoint.slotOrdinal]!.checkpoint, checkpoint);
		}
		assert.deepEqual(plan.graphAdmissionRequests.map(request => request.checkpointIndex), selected === 'neutral' ? [2, 3] : [1, 2]);
		assert.deepEqual(plan.executedCheckpoints.map(checkpoint => checkpoint.executionIndex), [0, 1]);
		assert.deepEqual(plan.graphAdmissionRequests.map(request => request.executionIndex), [0, 1]);
		assert.equal(plan.selectedExecutionIndex, selected === 'neutral' ? 1 : 0);
		for (const request of plan.graphAdmissionRequests) {
			assert.equal(request.binding, plan.checkpoints[request.checkpointIndex]!.binding);
			assert.equal(request.graph, request.binding.graph); assert.equal(request.descriptor, plan.slots[request.slotOrdinal]!.incoming);
			assert.deepEqual(extent(request.descriptor), [request.binding.width, request.binding.height]);
		}
		for (const value of [plan, plan.slots, plan.checkpoints, plan.graphAdmissionRequests, ...plan.slots, ...plan.checkpoints,
			...plan.checkpoints.map(checkpoint => checkpoint.blend), ...plan.graphAdmissionRequests]) assert.equal(Object.isFrozen(value), true);
	}
});

test('CPU preparation decides candidate existence, including zero-mix B/W, quantized spatial neutral and raw optic activity', () => {
	const fixtures = [
		{ value: effect('white-balance-v1', 'white'), candidate: false },
		{ value: effect('black-white-mix-v1', 'black-white'), candidate: true },
		{ value: effect('detail-sharpen-v1', 'detail-neutral', { amount: .1 }), candidate: false },
		{ value: effect('detail-sharpen-v1', 'detail-active', { amount: .5 }), candidate: true },
		{ value: effect('clarity-v1', 'clarity-disabled', { amount: 50 }, false), candidate: false },
		{ value: effect('defringe-v1', 'defringe-neutral'), candidate: false },
		{ value: effect('defringe-v1', 'defringe-raw', { purple: Number.MIN_VALUE }), candidate: true },
		{ value: effect('optical-vignette-v1', 'optical-neutral'), candidate: false },
		{ value: effect('optical-vignette-v1', 'optical-raw', { amount: Number.MIN_VALUE }), candidate: true },
		{ value: effect('chromatic-aberration-v1', 'ca-neutral'), candidate: false },
		{ value: effect('chromatic-aberration-v1', 'ca-raw', { red: Number.MIN_VALUE }), candidate: true },
		{ value: { id: 'lut-null', type: 'cube-lut-profile-v1', enabled: true, params: { lut: null } }, candidate: false },
		{ value: { id: 'lut-disabled', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT } }, candidate: false },
	];
	for (const fixture of fixtures) {
		const plan = prepare(metadata([fixture.value], [fixture.value.id]));
		assert.equal(plan.slots[0]!.candidateRequired, fixture.candidate, fixture.value.id);
		assert.equal(plan.checkpoints[0]!.mode, fixture.candidate ? 'blend' : 'declared-only');
		assert.equal(plan.imageTextureCount, fixture.candidate ? 3 : 2);
		if (fixture.value.id === 'clarity-disabled') assert.equal(plan.slots[0]!.pass?.kind, 16, 'Existing inactive private pass is retained.');
	}
});

test('CA raw-zero copies and Current unchanged-component blending remain explicit checkpoint policies', () => {
	const effects = [effect('chromatic-aberration-v1', 'ca', { red: Number.MIN_VALUE }),
		effect('defringe-v1', 'defringe', { purple: 100 }), effect('optical-vignette-v1', 'optical', { amount: 100 }),
		effect('tone-ladder-v1', 'generic', { exposure: 1 })];
	const plan = prepare(metadata(effects, effects.map(value => value.id)));
	assert.deepEqual(plan.checkpoints.map(checkpoint => checkpoint.blend), [
		{ kind: 'ca-copy', copyRed: false, copyBlue: true }, { kind: 'unchanged-components' },
		{ kind: 'unchanged-components' }, { kind: 'generic' },
	]);
});

test('observe-only pointwise masks need two CPU planes but no third candidate texture; declarations alone execute no graph', () => {
	const effectValue = effect('tone-ladder-v1', 'off', {}, false);
	const observed = prepare(metadata([effectValue], ['off'], 'off'));
	assert.equal(observed.imageTextureCount, 2); assert.equal(observed.referenceBytes, 8 * 6 * 16 * 2);
	assert.equal(observed.graphAdmissionRequests.length, 1); assert.equal(observed.graphAdmissionComplete, false);
	const declared = prepare(metadata([effectValue], ['off']));
	assert.equal(declared.imageTextureCount, 2); assert.equal(declared.referenceBytes, 0);
	assert.equal(declared.graphAdmissionRequests.length, 0); assert.equal(declared.graphAdmissionComplete, true); assert.equal(declared.graphGpuBytes, 0);
});

test('high planner carries complete private mask admission with three targets and two CPU oracle planes', () => {
	const source = metadata([effect('tone-ladder-v1', 'tone', { exposure: 1 })], ['tone']), plan = gpuFor(source);
	assert.equal(plan.maskPipeline.imageTextureCount, 3); assert.equal(plan.pipeline.textureBytes, 3 * 8 * 6 * 16);
	assert.equal(plan.pipeline.referenceBytes, 2 * 8 * 6 * 16); assert.equal(plan.pipeline.hasPlaneReference, true);
	assert.equal(plan.workingPlanComplete, true); assert.equal(plan.eligible, true); assert.equal(plan.unsupported, false);
	assert.equal(plan.maskPipeline.graphGpuBytes, null);
	assert.ok(plan.maskPhase); assert.ok(plan.maskContext);
	assert.equal(plan.maskPhase.contextPlan, plan.maskContext); assert.equal(plan.maskPhase.checkpointPlan, plan.maskPipeline);
	assert.equal(plan.maskPhase.imageTextureBytes, 3 * 8 * 6 * 16); assert.equal(plan.maskPhase.referenceBytes, 2 * 8 * 6 * 16);
	assert.equal(plan.gpuWorkingBytes, plan.maskPhase.peakWorkingBytes);
});

test('a bound pointwise recipe fitting two targets but not three is refused using metadata without plane allocation', () => {
	const source = metadata([effect('tone-ladder-v1', 'tone', { exposure: 1 })], ['tone'], undefined, 4096, 1536);
	const f = 4096 * 1536 * 16, p = gpuFor(source), presentation = 4096 * 1536 * 4 + 4_194_304 * 4;
	assert.ok(f * 7 + presentation <= 768 * 1024 * 1024); assert.ok(f * 8 + presentation > 768 * 1024 * 1024);
	assert.ok(p.maskPhase); assert.ok(p.gpuWorkingBytes > 768 * 1024 * 1024);
	assert.equal(p.maskPhase.imageTextureBytes, 3 * f); assert.equal(p.maskPhase.referenceBytes, 2 * f);
	assert.equal(p.gpuWorkingBytes, Math.max(...p.maskPhase.phases.map(phase => phase.totalBytes)));
	assert.equal(p.eligible, false); assert.equal(p.unsupported, false);
});

test('source and body capabilities are never opened and future caller mutations cannot retarget captured slots', () => {
	let opens = 0;
	const source = { withBytes(): never { opens++; return assert.fail('LUT bodies stay closed during planning.'); } };
	const params = { exposure: 1 }, mutable = { id: 'tone', type: 'tone-ladder-v1', enabled: true, params };
	const effects = [mutable, { id: 'lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: LUT } }];
	const scalar = metadataFor({ frame: frame(), develop: { ...BASE, effects, masks: [graph], maskBindings: [{ maskId: 'shared', effectId: 'tone' }] } }, PROFILE, { source });
	mutable.id = 'changed'; params.exposure = 4; effects.length = 0;
	const plan = prepare(scalar); assert.equal(opens, 0); assert.equal(plan.checkpoints[0]!.binding.effectId, 'tone');
	assert.deepEqual(plan.passes.map(pass => 'id' in pass ? pass.id : pass.type), ['tone', 'lut']);
	assert.equal(plan.slots[0]!.candidateRequired, true); assert.equal(plan.slots[1]!.candidateRequired, true);
});

test('private metadata and mask-pipeline identities refuse copied or revoked capabilities without reflection', () => {
	const scalar = metadata([effect('tone-ladder-v1', 'tone', { exposure: 1 })]), plan = prepare(scalar);
	let probes = 0;
	const hostile = new Proxy({}, { get() { probes++; throw new Error('get'); }, getOwnPropertyDescriptor() { probes++; throw new Error('own'); }, getPrototypeOf() { probes++; throw new Error('prototype'); } });
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	for (const value of [null, 1, hostile, revoked.proxy, { ...scalar }]) assert.throws(() => prepare(value), /owning|metadata/u);
	for (const value of [null, 1, hostile, revoked.proxy, { ...plan }]) { assert.equal(isPlan(value), false); assert.throws(() => read(value), /owning|prepared/u); }
	assert.equal(probes, 0);
});


test('every existing disabled encoded-only family keeps its captured noop slot without a GPU pass', () => {
	const families = ['color-adjust', 'pixelate', 'vignette', 'gaussian-blur', 'sharpen', 'rgb-split',
		'chroma-key', 'luma-key', 'spill-suppression', 'glow', 'outline', 'drop-shadow'];
	const effects = families.map(type => effect(type, type, {}, false));
	const scalar = proxyMetadataFor({ frame: { descriptor: { schemaVersion: 1, width: 2, height: 1,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } }, develop: { ...BASE, effects } }, PROFILE, {});
	const plan = prepare(scalar);
	assert.deepEqual(scalar.stages.map(stage => stage.kind), families.map(() => 'noop'));
	assert.equal(plan.passes.length, 0); assert.equal(plan.slots.length, families.length);
	assert.deepEqual(plan.slots.map(slot => slot.stageIndex), families.map((_value, index) => index));
	assert.ok(plan.slots.every(slot => !slot.candidateRequired && slot.pass === undefined));
	assert.deepEqual(plan.slots.map(slot => slot.identity.origin === 'effect' ? slot.identity.effectId : ''), families);
});
