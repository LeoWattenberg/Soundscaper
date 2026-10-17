/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2MaskContextCurrentV1 as prepare, readPixelFrameWebGl2MaskContextCurrentV1 as read } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-context-plan-current-v1.ts';
import { readPixelFrameWebGl2MaskSelectedTextureCurrentV1 as readSelected } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-context-current-v1.ts';
import { preparePixelFrameWebGl2MaskPlanCurrentV1 as checkpointsFor, readPixelFrameWebGl2MaskCheckpointPlanCurrentV1 } from '../src/common/editor/imaging/pixel-frame-webgl2-mask-plan-current-v1.ts';
import { prepareLinearDevelopMetadataCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const gradient = { id: 'a', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };
const graph = { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], nodes: [gradient], outputNodeId: 'a' };
const frame = (width = 8, height = 6) => ({ descriptor: { schemaVersion: 1 as const, width, height,
	sampleFormat: 'float32' as const, transfer: 'linear' as const, primaries: 'srgb' as const },
	get pixels(): never { return assert.fail('Context graph compilation must precede source sample access.'); } });
const effect = (id: string, enabled = true, exposure = 1) => createVideoEffect('tone-ladder-v1', { id, enabled, params: { exposure } });
function metadata(effects: readonly unknown[], bindings: readonly string[], selected?: string, value: unknown = graph, width = 8, height = 6) {
	return prepareLinearDevelopMetadataCurrentV1({ frame: frame(width, height), develop: { ...defaultImageDevelopStateV2(), effects,
		masks: bindings.length ? [value] : [], maskBindings: bindings.map(effectId => ({ maskId: 'mask', effectId })) },
		...(selected ? { maskOverlay: { maskId: 'mask', effectId: selected } } : {}) }, PROFILE, {});
}

test('context graph compilation retains exact owning bindings, authored order and incoming extents', () => {
	const scalar = metadata([effect('first'), createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: .5 } }), effect('last')], ['first', 'last'], 'last');
	const checkpoints = checkpointsFor(scalar), captured = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(checkpoints), plan = prepare(checkpoints);
	assert.equal(read(plan), plan); assert.equal(plan.checkpointPlan, captured); assert.equal(plan.entries.length, 2);
	assert.deepEqual(plan.entries.map(entry => [entry.graph.descriptor.width, entry.graph.descriptor.height]), [[8, 6], [4, 6]]);
	for (let index = 0; index < plan.entries.length; index++) {
		assert.equal(plan.entries[index]!.checkpoint, checkpoints.executedCheckpoints[index]);
		assert.equal(plan.entries[index]!.checkpoint.binding, captured.graphAdmissionRequests[index]!.binding);
		assert.equal(plan.entries[index]!.checkpoint.binding.graph, captured.graphAdmissionRequests[index]!.graph);
		assert.ok(Object.isFrozen(plan.entries[index])); assert.ok(Object.isFrozen(plan.entries[index]!.graph.steps));
	}
	assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.entries));
	assert.equal(checkpoints.graphAdmissionComplete, false, 'A context proposal does not enroll a completed broker/receipt/overlay ledger.');
	assert.equal(checkpoints.graphGpuBytes, null);
});

test('selected disabled or neutral adjustments compile observe coverage while unrelated declarations produce no graph', () => {
	for (const selected of ['disabled', 'neutral']) {
		const checkpoints = checkpointsFor(metadata([effect('unselected', false), effect('disabled', false), effect('neutral', true, 0)], ['unselected', 'disabled', 'neutral'], selected));
		const plan = prepare(checkpoints); assert.equal(plan.entries.length, 1); assert.equal(plan.entries[0]!.checkpoint.effectId, selected);
		assert.equal(plan.entries[0]!.checkpoint.mode, 'observe'); assert.equal(plan.entries[0]!.checkpoint.selected, true);
		assert.equal(checkpoints.imageTextureCount, 2); assert.equal(checkpoints.checkpoints.length, 3);
	}
});

test('context reserve distinguishes private native uint readback from the separately owned canonical receipt stripe', () => {
	const checkpoints = checkpointsFor(metadata([effect('first')], ['first'])), plan = prepare(checkpoints);
	assert.equal(plan.nativeReadbackBytes, 4096 * 4 * 4); assert.equal(plan.probeBytes, 4096); assert.equal(plan.stateBytes, 4096);
	assert.equal(plan.graphExecutionBytes, plan.entries[0]!.graph.graphGpuBytes);
	assert.equal(plan.workingBytes, plan.graphExecutionBytes + 65_536 + 4096);
	assert.equal(plan.eligible, true);
	const empty = prepare(checkpointsFor(metadata([effect('plain')], [])));
	assert.equal(empty.entries.length, 0); assert.equal(empty.workingBytes, 0); assert.equal(empty.nativeReadbackBytes, 0);
});

test('phase-incomplete conservative compiler refuses a four-megapixel feather without allocating source planes', () => {
	const feather = { ...graph, nodes: [gradient, { id: 'f', kind: 'feather', inputNodeId: 'a', radius: 64 }], outputNodeId: 'f' };
	const checkpoints = checkpointsFor(metadata([effect('tone')], ['tone'], undefined, feather, 2048, 2048)), plan = prepare(checkpoints);
	assert.ok(checkpoints.knownMaskComponentBytes <= 64 * 1024 * 1024);
	assert.equal(plan.eligible, false, 'Final C phase ledger must replace this conservative overlap admission before activation.');
});

test('captured graph controls and dead brush declarations cannot be retargeted or opened by scalar context planning', () => {
	let opens = 0; const key = `brush-mask-v1:1:1:${'0'.repeat(64)}`;
	const start = { x: 0, y: 0 }, mutable = { ...graph, inputs: [{ name: 'Unused', kind: 'alpha', sourceRef: key }],
		nodes: [{ ...gradient, start }, { id: 'dead', kind: 'alpha', inputName: 'Unused' }] };
	const scalar = prepareLinearDevelopMetadataCurrentV1({ frame: frame(), develop: { ...defaultImageDevelopStateV2(), effects: [effect('tone')], masks: [mutable], maskBindings: [{ maskId: 'mask', effectId: 'tone' }] } }, PROFILE,
		{ maskSource: { withBytes(): never { opens++; return assert.fail('All body authentication belongs to the outer resource scope.'); } } });
	start.x = .25; mutable.nodes.length = 0;
	const plan = prepare(checkpointsFor(scalar)); assert.equal(opens, 0);
	assert.equal(plan.checkpointPlan.metadata.masks.references.length, 1); assert.deepEqual(plan.entries[0]!.graph.retainedStorageKeys, []);
	assert.deepEqual(plan.entries[0]!.graph.steps.map(step => step.nodeId), ['a']);
	assert.equal(plan.entries[0]!.graph.steps[0]!.uniforms.params0[0], 0);
});

test('copied or revoked plans and selected texture impostors are refused without caller reflection', () => {
	const checkpoints = checkpointsFor(metadata([effect('tone')], ['tone'], 'tone')), plan = prepare(checkpoints);
	let probes = 0; const hostile = new Proxy({}, { get() { probes++; throw new Error('get'); }, getOwnPropertyDescriptor() { probes++; throw new Error('own'); }, getPrototypeOf() { probes++; throw new Error('prototype'); } });
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	for (const value of [null, 1, hostile, revoked.proxy, { ...checkpoints }]) assert.throws(() => prepare(value), TypeError);
	for (const value of [null, 1, hostile, revoked.proxy, { ...plan }]) assert.throws(() => read(value), TypeError);
	for (const texture of [null, 1, hostile, revoked.proxy, {}]) assert.throws(() => readSelected(texture, hostile, checkpoints.executedCheckpoints[0]), TypeError);
	assert.equal(probes, 0);
});
