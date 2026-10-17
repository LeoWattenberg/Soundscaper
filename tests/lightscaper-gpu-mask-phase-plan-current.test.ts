/* SPDX-License-Identifier: AGPL-3.0-only */
// Scalar physical admission; native execution has separate browser qualification.
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearDevelopMetadataCurrentV1 as metadata } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 as checkpointPlan } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2MaskContextCurrentV1 as contextPlan } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { withPixelFrameWebGl2MaskContextCurrentV1 as withContext } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-context-current-v1.ts';
import { preparePixelFrameWebGl2MaskOverlayCurrentV1 as overlayPlan } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-overlay-plan-current-v1.ts';
import { prepareImageDevelopGpuMaskPhasePlanCurrentV1 as prepare, readImageDevelopGpuMaskPhasePlanCurrentV1 as read } from '../src/common/editor/imaging/image-develop-gpu-mask-phase-plan-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import type { ImageDevelopFrameOptionsV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';

const MiB = 1024 * 1024;
const gradient = { id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
const tone = () => createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } });
const graph = (nodes: readonly unknown[], id = 'local', inputs: readonly unknown[] = []) => ({ schemaVersion: 1, id, kind: 'mask', inputs, nodes, outputNodeId: nodes.length === 1 ? 'gradient' : 'feather' });
function setup(width: number, height: number, develop: unknown, selected = false, options: ImageDevelopFrameOptionsV3 = {}) {
	const frame = { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm16' as const, primaries: 'srgb' as const, transfer: 'linear' as const },
		get pixels(): never { return assert.fail('Complete phase planning must precede native source properties.'); } };
	const m = metadata({ frame, develop, ...(selected ? { maskOverlay: { effectId: 'tone', maskId: 'local' } } : {}) }, PROFILE, options);
	const c = checkpointPlan(m), context = contextPlan(c), overlay = selected ? overlayPlan(c) : undefined;
	return { metadata: m, checkpoints: c, context, overlay };
}
function feather() { return setup(2048, 2048, { ...defaultImageDevelopStateV2(), effects: [tone()],
	masks: [graph([gradient, { id: 'feather', kind: 'feather', inputNodeId: 'gradient', radius: 1 }])], maskBindings: [{ effectId: 'tone', maskId: 'local' }] }); }
function phase(plan: ReturnType<typeof prepare>, name: string) { const found = plan.phases.find(value => value.name === name); assert.ok(found); return found; }

test('4MP feather preserves old64MiB CPU admission and fits genuinely disjoint GPU/CPU graph phases', () => {
	const f = feather(), p = prepare(f.checkpoints, f.context);
	assert.equal(f.metadata.masks.peakWorkingBytes, 40 * MiB, 'Two cached byte nodes plus8P CPU feather scratch.');
	assert.equal(f.context.entries[0]!.graph.graphGpuBytes, 24 * MiB + 65, 'Two R8UI banks, one R32UI bank, scalar reserve and dummy.');
	assert.ok(40 * MiB + f.context.entries[0]!.graph.graphGpuBytes + 65536 > 64 * MiB, 'A blind CPU+GPU SUM would incorrectly decline this combination.');
	assert.equal(p.legacyMaskAdmissionBytes, 40 * MiB); assert.equal(p.imageTextureBytes, 192 * MiB); assert.equal(p.referenceBytes, 128 * MiB);
	assert.equal(p.readbackBytes, 64 * MiB); assert.equal(p.floatCaptureBytes, 64 * MiB);
	assert.ok(p.maximumMaskComponentBytes > 40 * MiB && p.maximumMaskComponentBytes < 41 * MiB);
	assert.ok(p.peakWorkingBytes > 520 * MiB && p.peakWorkingBytes < 521 * MiB); assert.equal(p.eligible, true);
	assert.ok(phase(p, 'gpu-coverage-and-blend').maskBytes < 25 * MiB);
	assert.ok(phase(p, 'cpu-coverage-proof').maskBytes < 41 * MiB);
	assert.equal(read(p), p);
});

test('padded physical Original is charged before allocation; an ineligible GPU choice preserves a fitting direct CPU route', () => {
	const f = feather();
	for (const physical of [500 * MiB, 550 * MiB, 600 * MiB, 600 * MiB + 1]) {
		const p = prepare(f.checkpoints, f.context, undefined, physical);
		assert.equal(p.directCpuPeakBytes, physical + 168 * MiB); assert.equal(p.attemptedFallbackPeakBytes, physical + 232 * MiB);
		assert.equal(p.eligible, false); assert.equal(p.directCpuEligible, physical <= 600 * MiB);
	}
	// At600MiB the unchanged direct CPU path exactly fits768MiB; opening the
	// lower GPU owner first would add a needless64MiB stable capture and fail.
});

test('selected4MP projection charges BOTH native readbacks and canonical scratch, then retires GPU banks before CPU proof', () => {
	const f = setup(4096, 1024, { ...defaultImageDevelopStateV2(), effects: [
		createVideoEffect('tone-ladder-v1', { id: 'tone', enabled: false }), createVideoEffect('develop-geometry-v1', { id: 'identity' }) ],
		masks: [graph([gradient])], maskBindings: [{ effectId: 'tone', maskId: 'local' }] }, true);
	assert.ok(f.overlay); const p = prepare(f.checkpoints, f.context, f.overlay), gpu = phase(p, 'gpu-selected-byte-projection'), cpu = phase(p, 'cpu-selected-byte-proof');
	assert.equal(f.overlay.projectionTextureBytes, 8 * MiB); assert.equal(f.overlay.retainedHostBytes, 4 * MiB);
	assert.equal(f.context.nativeReadbackBytes, 65536); assert.equal(f.overlay.nativeReadbackBytes, 65536);
	assert.ok(p.receiptBytes > 65536); assert.ok(gpu.maskBytes > 16 * MiB + 3 * 65536 && gpu.maskBytes < 17 * MiB);
	assert.equal(f.overlay.cpuProjectionBytes, 52 * MiB); assert.ok(cpu.maskBytes > 60 * MiB && cpu.maskBytes < 61 * MiB);
	assert.equal(p.retainedOverlayBytes, 4 * MiB); assert.equal(p.maximumMaskComponentBytes, cpu.maskBytes); assert.equal(p.eligible, true);
	assert.equal(phase(p, 'accepted-presentation').maskBytes, 20 * MiB + 4096);
});

test('retained selected host storage is charged even before the selected checkpoint executes', () => {
	const f = setup(1024, 1024, { ...defaultImageDevelopStateV2(), effects: [
		createVideoEffect('tone-ladder-v1', { id: 'first', params: { exposure: 1 } }), createVideoEffect('tone-ladder-v1', { id: 'tone', enabled: false }) ],
		masks: [graph([gradient, { id: 'feather', kind: 'feather', inputNodeId: 'gradient', radius: 1 }], 'first-mask'), graph([gradient])],
		maskBindings: [{ effectId: 'first', maskId: 'first-mask' }, { effectId: 'tone', maskId: 'local' }] }, true);
	const p = prepare(f.checkpoints, f.context, f.overlay), first = p.phases.find(value => value.name === 'gpu-coverage-and-blend' && value.executionIndex === 0);
	assert.ok(first); assert.equal(f.checkpoints.selectedExecutionIndex, 1); assert.equal(p.retainedOverlayBytes, MiB);
	assert.equal(first.maskBytes, f.context.entries[0]!.graph.graphGpuBytes + f.context.nativeReadbackBytes + f.context.stateBytes + p.receiptBytes + MiB);
	assert.equal(phase(p, 'source-capture').maskBytes, MiB); assert.equal(phase(p, 'lut-authentication').maskBytes, MiB);
});

test('serial authentication includes retained brushes from disabled/unselected bindings without allocating their GPU graphs', () => {
	let reads = 0; const options: ImageDevelopFrameOptionsV3 = { maskSource: { withBytes() { reads++; throw new Error('No body I/O during phase planning.'); } } };
	const keys = [`brush-mask-v1:1024:1:${'a'.repeat(64)}`, `brush-mask-v1:1:1024:${'b'.repeat(64)}`];
	const unused = { schemaVersion: 1, id: 'off-graph', kind: 'mask', inputs: keys.map((sourceRef, index) => ({ name: `p${index}`, kind: 'alpha', sourceRef })),
		nodes: [{ id: 'a', kind: 'alpha', inputName: 'p0' }, { id: 'b', kind: 'alpha', inputName: 'p1' }, { id: 'both', kind: 'boolean', operation: 'union', inputNodeIds: ['a', 'b'] }], outputNodeId: 'both' };
	const f = setup(1, 1, { ...defaultImageDevelopStateV2(), effects: [tone(), createVideoEffect('tone-ladder-v1', { id: 'off', enabled: false })],
		masks: [graph([gradient]), unused], maskBindings: [{ effectId: 'tone', maskId: 'local' }, { effectId: 'off', maskId: 'off-graph' }] }, false, options);
	const p = prepare(f.checkpoints, f.context); assert.equal(p.retainedBrushBytes, 2048); assert.equal(p.brushAuthBytes, 2048 + 4 * 1040 + 64);
	assert.equal(p.retainedStorageKeys.length, 2); assert.equal(f.context.entries.length, 1); assert.equal(f.context.entries[0]!.graph.brushTextureBytes, 0); assert.equal(reads, 0);
});

test('one reusable brush GPU bank uses maxWidth*maxHeight, not largest single reference area', () => {
	const refs = [`brush-mask-v1:1024:1:${'a'.repeat(64)}`, `brush-mask-v1:1:1024:${'b'.repeat(64)}`];
	const body = { schemaVersion: 1, id: 'local', kind: 'mask', inputs: refs.map((sourceRef, index) => ({ name: `p${index}`, kind: 'alpha', sourceRef })),
		nodes: [{ id: 'a', kind: 'alpha', inputName: 'p0' }, { id: 'b', kind: 'alpha', inputName: 'p1' }, { id: 'both', kind: 'boolean', operation: 'union', inputNodeIds: ['a', 'b'] }], outputNodeId: 'both' };
	const f = setup(1, 1, { ...defaultImageDevelopStateV2(), effects: [tone()], masks: [body], maskBindings: [{ effectId: 'tone', maskId: 'local' }] }, false,
		{ maskSource: { withBytes() { throw new Error('No body read.'); } } });
	const p = prepare(f.checkpoints, f.context); assert.equal(f.context.entries[0]!.graph.brushTextureBytes, MiB); assert.equal(p.retainedBrushBytes, 2048);
	assert.ok(phase(p, 'gpu-coverage-and-blend').maskBytes > MiB + 2048);
});

test('LUT parser/oracle/upload/texture phases retain unique65³ Double tables without overlapping graph or CPU planes', () => {
	const reference = (letter: string) => ({ storageKey: `lut-sha256:${letter.repeat(64)}`, sha256: letter.repeat(64), byteLength: 2 * MiB,
		size: 65, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
	const effects = [tone(), ...['a', 'b', 'a'].map((letter, index) => createVideoEffectV2('cube-lut-profile-v1', { id: `lut${index}`, params: { lut: reference(letter) } }))];
	const f = setup(4, 4, { ...defaultImageDevelopStateV2(), effects, masks: [graph([gradient])], maskBindings: [{ effectId: 'tone', maskId: 'local' }] }, false,
		{ source: { withBytes() { throw new Error('No source read.'); } } });
	const p = prepare(f.checkpoints, f.context), oracle = 2 * 65 ** 3 * 3 * 8, bank = 65 ** 3 * 4 * 4;
	assert.equal(p.lutOracleBytes, oracle); assert.equal(p.lutUploadBytes, bank); assert.equal(p.lutTextureBytes, bank);
	assert.equal(p.lutCaptureBytes, oracle + 128 * MiB + 16 * MiB + 2 * MiB);
	assert.equal(phase(p, 'lut-authentication').totalBytes, 128 + 256 + p.lutCaptureBytes);
	assert.ok(phase(p, 'accepted-presentation').totalBytes < phase(p, 'cpu-coverage-proof').totalBytes);
});

test('forged or mismatched private plans and under-declared physical source are protocol errors', () => {
	const a = feather(), b = feather();
	assert.throws(() => prepare({ ...a.checkpoints }, a.context), TypeError);
	assert.throws(() => prepare(a.checkpoints, b.context), TypeError);
	assert.throws(() => prepare(a.checkpoints, a.context, undefined, 1), RangeError);
	assert.throws(() => read({}), TypeError);
	const reason = Proxy.revocable({}, {}); reason.revoke(); assert.throws(() => read(reason.proxy), TypeError);
});

test('context refuses forged or foreign complete phase authority before native reflection or callbacks', async () => {
	const a = feather(), b = feather(), phase = prepare(a.checkpoints, a.context);
	const foreign = prepare(b.checkpoints, b.context);
	const gl = new Proxy({} as WebGL2RenderingContext, { get() { return assert.fail('Invalid phase must precede GL access.'); } });
	for (const phasePlan of [{ ...phase }, foreign]) await assert.rejects(withContext({ gl, prepared: a.context, phasePlan,
		checkCurrent() { assert.fail('Foreign phase must precede currentness callbacks.'); },
		unavailable(): never { return assert.fail('Protocol faults cannot become capability refusal.'); },
	}, () => assert.fail('No context consumer.')), TypeError);
});

test('genuine over-budget phase refuses before native allocation while standalone admission stays conservative', async () => {
	const a = feather(), phase = prepare(a.checkpoints, a.context, undefined, 500 * MiB);
	assert.equal(a.context.eligible, false); assert.equal(phase.eligible, false);
	const gl = new Proxy({} as WebGL2RenderingContext, { get() { return assert.fail('Working-set refusal must precede GL access.'); } });
	const reason = new Error('Expected private working-set refusal.'); let currentChecks = 0;
	for (const phasePlan of [undefined, phase]) {
		const result = await withContext({ gl, prepared: a.context, ...(phasePlan ? { phasePlan } : {}),
			checkCurrent() { currentChecks++; }, unavailable(value): never { assert.equal(value, 'mask-working-set'); throw reason; },
		}, () => assert.fail('No context consumer.')).then(value => ({ value }), (error: unknown) => ({ error }));
		assert.ok('error' in result && Object.is(result.error, reason));
	}
	assert.equal(currentChecks, 2);
});
