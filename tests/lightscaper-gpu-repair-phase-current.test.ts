/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearDevelopMetadataCurrentV1 as metadata } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { prepareImageDevelopGpuPlanCurrentV1 as gpuPlan } from '../src/common/editor/imaging/image-develop-gpu-plan-current-v1.ts';
import { prepareImageDevelopGpuMaskPhasePlanCurrentV1 as prepare, readImageDevelopGpuMaskPhasePlanCurrentV1 as read } from '../src/common/editor/imaging/image-develop-gpu-mask-phase-plan-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import { readPixelFrameWebGl2RepairCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-repair-current-v1.ts';
import type { ImageDevelopFrameOptionsV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
const MiB = 1024 * 1024, TOTAL = 768 * MiB;
const spot = (mode: 'clone' | 'heal' = 'heal') => ({ id: 'repair', mode, enabled: true,
	target: { x: .5, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: 0, opacity: 1 });
const recipe = (spots: readonly unknown[] = [spot()]) => ({ ...defaultImageDevelopStateV2(), processVersion: 3, repairs: { schemaVersion: 1, spots } });
const tone = () => createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } });
const gradient = { id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
const mask = { schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [gradient], outputNodeId: 'gradient' };
function setup(width: number, height: number, develop: unknown, options: ImageDevelopFrameOptionsV3 = {}, selected = false) {
	let samples = 0;
	const frame = { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm16' as const, primaries: 'srgb' as const, transfer: 'linear' as const },
		get pixels(): never { samples++; return assert.fail('All complete repair phases must precede native sample admission.'); } };
	const m = metadata({ frame, develop, ...(selected ? { maskOverlay: { effectId: 'tone', maskId: 'local' } } : {}) }, PROFILE, options);
	return { metadata: m, gpu: gpuPlan(m), samples: () => samples };
}
function phase(plan: ReturnType<typeof prepare>, name: string) {
	const value = plan.phases.find(row => row.name === name); assert.ok(value, name); return value;
}

test('repair-only recipes use the complete private phase, three reusable native banks and two CPU oracle planes without mask receipts', () => {
	const f = setup(10, 5, recipe()), p = f.gpu.maskPhase; assert.ok(p); assert.ok(p.repairPrefix);
	assert.equal(read(p), p); assert.equal(readPixelFrameWebGl2RepairCurrentV1(p.repairPrefix), p.repairPrefix);
	assert.equal(p.imageTextureCount, 3); assert.equal(p.imageTextureBytes, 3 * 10 * 5 * 16);
	assert.equal(p.referenceBytes, 2 * 10 * 5 * 16); assert.equal(p.receiptBytes, 0);
	assert.equal(f.gpu.maskPipeline.executedCheckpoints.length, 0); assert.equal(f.gpu.maskContext?.entries.length, 0);
	assert.equal(f.gpu.pipeline.imageTextureCount, 3); assert.equal(f.gpu.pipeline.hasPlaneReference, true);
	assert.equal(f.gpu.unsupported, false); assert.equal(f.gpu.eligible, true); assert.equal(f.samples(), 0);
});

test('4MP Heal and radius64 feather fit disjoint GPUhalo/CPUrepair/mask phases without adding an Original plane', () => {
	const heal = { ...spot(), radius: 255 / 2048 };
	const f = setup(2048, 2048, { ...recipe([heal]), effects: [tone()],
		masks: [{ ...mask, nodes: [gradient, { id: 'feather', kind: 'feather', inputNodeId: 'gradient', radius: 64 }], outputNodeId: 'feather' }],
		maskBindings: [{ effectId: 'tone', maskId: 'local' }] });
	const p = f.gpu.maskPhase; assert.ok(p); assert.ok(p.repairPrefix);
	const halo = p.repairPrefix.spots[0]!.halo!; assert.equal(halo.width, 512); assert.equal(halo.height, 512);
	assert.equal(p.repairGpuHaloBytes, 129 * 512 ** 2); assert.equal(p.repairCpuScratchBytes, 105 * 512 ** 2 + 4096);
	assert.equal(p.floatCaptureBytes, 64 * MiB); assert.equal(p.imageTextureBytes, 192 * MiB); assert.equal(p.referenceBytes, 128 * MiB);
	const gpu = phase(p, 'gpu-original-repair-prefix'), cpu = phase(p, 'cpu-original-repair-prefix-proof');
	const maskProof = phase(p, 'cpu-coverage-proof'), ordinaryReplay = phase(p, 'cpu-native-replay');
	assert.equal(cpu.totalBytes - ordinaryReplay.totalBytes, 105 * 512 ** 2 + 4096);
	assert.equal(gpu.totalBytes, p.physicalSourceBytes + p.floatCaptureBytes + p.imageTextureBytes + p.repairGpuHaloBytes + 4096 + p.receiptBytes);
	assert.equal(gpu.maskBytes, p.receiptBytes); assert.equal(cpu.maskBytes, p.receiptBytes);
	assert.equal(maskProof.maskBytes, 40 * MiB + p.receiptBytes);
	assert.ok(p.maximumMaskComponentBytes < 41 * MiB); assert.ok(p.peakWorkingBytes > 520 * MiB && p.peakWorkingBytes < 521 * MiB);
	assert.equal(p.eligible, true); assert.equal(f.samples(), 0);
});

test('the Original-space prefix precedes legacy crop/rotation and all actual authored slot extents', () => {
	const f = setup(8, 4, { ...recipe([spot('clone')]), geometry: { crop: { x: .25, y: 0, width: .5, height: 1 }, rotationDegrees: 90, flipHorizontal: false, flipVertical: false }, effects: [tone()] });
	const p = f.gpu.maskPhase; assert.ok(p?.repairPrefix);
	assert.equal(p.repairPrefix.descriptor.width, 8); assert.equal(p.repairPrefix.descriptor.height, 4);
	assert.equal(f.gpu.maskPipeline.slots[0]!.identity.origin, 'legacy-geometry');
	assert.equal(f.gpu.maskPipeline.slots[0]!.incoming, f.metadata.descriptor);
	assert.equal(f.gpu.maskPipeline.finalDescriptor.width, 4); assert.equal(f.gpu.maskPipeline.finalDescriptor.height, 4);
	assert.equal(p.imageTextureBytes, 3 * 8 * 4 * 16); assert.equal(p.readbackBytes, 4 * 4 * 16);
});

test('physical rebasing retains the exact private prefix and complete authored/resource associations', () => {
	const f = setup(10, 5, recipe()), p = f.gpu.maskPhase; assert.ok(p);
	const rebased = prepare(f.gpu.maskPipeline, f.gpu.maskContext, f.gpu.maskOverlay, p.physicalSourceBytes + 128);
	assert.equal(rebased.repairPrefix, p.repairPrefix); assert.equal(rebased.checkpointPlan, p.checkpointPlan);
	assert.equal(rebased.contextPlan, p.contextPlan); assert.equal(rebased.overlayPlan, p.overlayPlan);
	for (const row of p.phases) assert.equal(phase(rebased, row.name).totalBytes, row.totalBytes + 128);
	assert.throws(() => read({ ...p }), TypeError); assert.throws(() => read({ ...p, repairPrefix: { ...p.repairPrefix } }), TypeError);
});

test('padded Original admission chooses fitting direct CPU before the extra stable GPU capture exists', () => {
	const f = setup(10, 5, recipe()), p = f.gpu.maskPhase; assert.ok(p);
	const extraCpu = f.metadata.peakWorkingBytes - f.metadata.sourcePlan.byteLength, physical = TOTAL - extraCpu;
	const bound = gpuPlan(f.metadata, physical), exceeded = gpuPlan(f.metadata, physical + 1);
	assert.ok(bound.maskPhase); assert.equal(bound.maskPhase.directCpuPeakBytes, TOTAL);
	assert.equal(bound.maskPhase.directCpuEligible, true); assert.equal(bound.maskPhase.attemptedFallbackPeakBytes, TOTAL + p.floatCaptureBytes);
	assert.equal(bound.eligible, false); assert.equal(exceeded.maskPhase?.directCpuEligible, false); assert.equal(f.samples(), 0);
});

test('repair activation keeps all brush/LUT/selected-overlay fees and authentic declaration keys unchanged', () => {
	const sourceRef = `brush-mask-v1:4:4:${'a'.repeat(64)}`, lut = { storageKey: `lut-sha256:${'b'.repeat(64)}`, sha256: 'b'.repeat(64), byteLength: 128,
		size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
	let reads = 0; const options: ImageDevelopFrameOptionsV3 = { source: { withBytes() { reads++; throw new Error('No LUT body during planning.'); } },
		maskSource: { withBytes() { reads++; throw new Error('No brush body during planning.'); } } };
	const effects = [tone(), createVideoEffectV2('cube-lut-profile-v1', { id: 'lut', params: { lut } })];
	const base = { ...defaultImageDevelopStateV2(), effects, masks: [{ ...mask, inputs: [{ name: 'declaration', kind: 'alpha', sourceRef }] }], maskBindings: [{ effectId: 'tone', maskId: 'local' }] };
	const old = setup(4, 4, base, options, true).gpu.maskPhase;
	const current = setup(4, 4, { ...base, processVersion: 3, repairs: { schemaVersion: 1, spots: [spot('clone')] } }, options, true).gpu.maskPhase;
	assert.ok(old); assert.ok(current?.repairPrefix);
	for (const name of ['retainedBrushBytes', 'brushAuthBytes', 'retainedOverlayBytes', 'receiptBytes', 'lutCaptureBytes', 'lutOracleBytes', 'lutUploadBytes', 'lutTextureBytes'] as const) assert.equal(current[name], old[name]);
	assert.deepEqual(current.retainedStorageKeys, old.retainedStorageKeys); assert.equal(reads, 0);
	assert.equal(phase(current, 'gpu-original-repair-prefix').maskBytes, current.retainedBrushBytes + current.retainedOverlayBytes + current.receiptBytes);
});

test('raw nonzero underflow controls stay unsupported, while disabled repairs retain the old unmasked owner', () => {
	const tiny = setup(10, 5, recipe([{ ...spot(), opacity: Number.MIN_VALUE }]));
	assert.ok(tiny.gpu.maskPhase?.repairPrefix); assert.equal(tiny.gpu.maskPhase.repairPrefix.supported, false);
	assert.equal(tiny.gpu.unsupported, true); assert.equal(tiny.gpu.eligible, false); assert.equal(tiny.samples(), 0);
	const disabled = setup(10, 5, recipe([{ ...spot(), enabled: false }]));
	assert.equal(disabled.metadata.repairs, undefined); assert.equal(disabled.gpu.maskPhase, undefined);
	assert.equal(disabled.gpu.pipeline.imageTextureCount, 2); assert.equal(disabled.gpu.pipeline.hasPlaneReference, false);
});
