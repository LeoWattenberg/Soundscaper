/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLinearDevelopMetadataCurrentV1 as prepare, prepareDevelopProxyMetadataCurrentV1 as prepareProxy,
	readLinearDevelopAuthoredSlotsCurrentV1 as read, isLinearDevelopAuthoredSlotsCurrentV1 as isOwner,
} from '../src/common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { prepareLinearDevelopCurrentV1 } from '../src/common/editor/imaging/image-develop-linear-plan-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { imageDevelopMaskTransformsCurrentV1 } from '../src/common/editor/imaging/image-develop-mask-plan-current-v1.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1 as PROFILE } from '../src/common/editor/photo-library-develop-linear-port-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const BASE = defaultImageDevelopStateV2();
const frame = (width = 8, height = 6) => ({ descriptor: { schemaVersion: 1 as const, width, height,
	sampleFormat: 'unorm16' as const, transfer: 'linear' as const, primaries: 'srgb' as const },
	get pixels(): never { return assert.fail('Authored metadata must remain body/pixel free.'); } });
const effect = (type: string, id: string, params: Record<string, number> = {}, enabled = true) => createVideoEffect(type, { id, params, enabled });
const graph = { schemaVersion: 2, id: 'shared', name: 'Same graph, distinct inputs', kind: 'matte', inputs: [],
	nodes: [{ id: 'gradient', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'gradient' };
function recipe() {
	return { ...BASE, geometry: { ...BASE.geometry, crop: { x: .25, y: 0, width: .5, height: 1 } }, effects: [
		effect('white-balance-v1', 'white-neutral'), effect('develop-geometry-v1', 'disabled-rotate', { rotationDegrees: 45 }, false),
		effect('tone-ladder-v1', 'tone-first', { exposure: 1 }), effect('develop-geometry-v1', 'crop', { cropWidth: .5 }),
		effect('tone-ladder-v1', 'tone-disabled', { exposure: 2 }, false), effect('lens-distortion-v1', 'real-lens-id', { amount: 25 }),
		effect('develop-geometry-v1', 'identity-filter'), effect('tone-ladder-v1', 'tone-neutral'),
	], masks: [graph], maskBindings: [
		{ maskId: 'shared', effectId: 'tone-first' }, { maskId: 'shared', effectId: 'tone-disabled' }, { maskId: 'shared', effectId: 'tone-neutral' },
	] };
}
const extent = (value: Readonly<{ width: number; height: number }>) => [value.width, value.height];

test('Current authored slots retain repeated families, one legacy prefix, disabled geometry and real identity filtering', () => {
	const metadata = prepare({ frame: frame(), develop: recipe() }, PROFILE, {}), owned = read(metadata), slots = owned.slots;
	assert.equal(metadata.authoredSlots, slots); assert.equal(owned.maskPlan, metadata.masks.plan); assert.equal(isOwner(metadata), true);
	assert.equal(slots.length, 9); assert.deepEqual(slots.map(slot => slot.ordinal), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
	assert.deepEqual(slots[0]!.identity, { origin: 'legacy-geometry' });
	assert.deepEqual(slots.slice(1).map(slot => slot.identity), metadata.develop.effects.map((item, effectIndex) => ({
		origin: 'effect', effectIndex, effectId: item.id, effectType: item.type, enabled: item.enabled,
	})));
	assert.deepEqual(slots.map(slot => slot.stageIndex), [0, 1, null, 2, 3, 4, 5, 6, 7]);
	assert.deepEqual(slots.map(slot => extent(slot.incoming)), [[8, 6], [4, 6], [4, 6], [4, 6], [4, 6], [2, 6], [2, 6], [2, 6], [2, 6]]);
	assert.deepEqual(slots.map(slot => extent(slot.output)), [[4, 6], [4, 6], [4, 6], [4, 6], [2, 6], [2, 6], [2, 6], [2, 6], [2, 6]]);
	for (let index = 1; index < slots.length; index++) assert.equal(slots[index]!.incoming, slots[index - 1]!.output);
	assert.equal(slots[0]!.incoming, metadata.descriptor); assert.equal(slots.at(-1)!.output, metadata.finalDescriptor);
	assert.equal(slots[2]!.incoming, slots[2]!.output); assert.equal(metadata.stages[6]!.kind, 'geometry');
	for (const value of [metadata, owned, slots, ...slots, ...slots.map(slot => slot.identity)]) assert.equal(Object.isFrozen(value), true);
});

test('slots retain exact owning Current mask bindings at distinct incoming extents and selected disabled identity', () => {
	const metadata = prepare({ frame: frame(), develop: recipe(), maskOverlay: { maskId: 'shared', effectId: 'tone-disabled' } }, PROFILE, {});
	const owned = read(metadata), bound = owned.slots.filter(slot => slot.binding !== undefined);
	assert.deepEqual(bound.map(slot => [slot.binding!.effectId, slot.binding!.width, slot.binding!.height]), [
		['tone-first', 4, 6], ['tone-disabled', 2, 6], ['tone-neutral', 2, 6],
	]);
	for (const slot of bound) {
		assert.equal(slot.binding, metadata.masks.plan.bindings.find(binding => binding.effectId === slot.binding!.effectId));
		assert.doesNotThrow(() => imageDevelopMaskTransformsCurrentV1(slot.binding!));
		assert.throws(() => imageDevelopMaskTransformsCurrentV1({ ...slot.binding! }), /admitted/u);
	}
	assert.equal(bound[1]!.binding, metadata.selectedBinding);
	assert.deepEqual(imageDevelopMaskTransformsCurrentV1(bound[0]!.binding!).map(transform => transform.kind), ['geometry', 'lens-distortion', 'geometry']);
	assert.deepEqual(imageDevelopMaskTransformsCurrentV1(bound[1]!.binding!).map(transform => transform.kind), ['lens-distortion', 'geometry']);
});

test('companion capture does not activate native color noops or remove legacy executable stages', () => {
	const value = { frame: frame(), develop: recipe() }, metadata = prepare(value, PROFILE, {}), native = prepareLinearDevelopCurrentV1(value, PROFILE, {});
	assert.deepEqual(metadata.stages.map(stage => stage.kind), ['geometry', 'color', 'color', 'geometry', 'color', 'lens-distortion', 'geometry', 'color']);
	assert.deepEqual(native.stages.map(stage => stage.kind), ['geometry', 'color', 'color', 'geometry', 'color', 'lens-distortion', 'geometry', 'color']);
	assert.deepEqual(native.stages.map(stage => stage.kind === 'color' ? [stage.id, stage.effects.length] : stage.kind),
		['geometry', ['white-neutral', 0], ['tone-first', 1], 'geometry', ['tone-disabled', 0], 'lens-distortion', 'geometry', ['tone-neutral', 0]]);
	assert.equal(isOwner(native), false); // Executable plans are distinct owners, not scalar checkpoint capabilities.
	assert.equal(metadata.peakWorkingBytes, native.peakWorkingBytes);
	assert.deepEqual(metadata.finalDescriptor, native.finalDescriptor);
	assert.equal(prepare({ frame: frame(1, 1), develop: BASE }, PROFILE, {}).peakWorkingBytes, 32);
	assert.equal(prepare({ frame: frame(1, 1), develop: { ...BASE, geometry: { ...BASE.geometry, flipHorizontal: true } } }, PROFILE, {}).peakWorkingBytes, 40);
});

test('every inactive authored family keeps its existing no-op representation without invented stages', () => {
	const effects = [effect('lens-distortion-v1', 'lens-zero'), effect('chromatic-aberration-v1', 'ca-zero'),
		effect('defringe-v1', 'defringe-zero'), effect('optical-vignette-v1', 'optical-zero'),
		effect('detail-sharpen-v1', 'detail-zero', { amount: 0 }), { id: 'lut-disabled', type: 'cube-lut-profile-v1', enabled: false, params: { lut: null } },
		effect('develop-geometry-v1', 'geometry-off', {}, false)];
	const metadata = prepare({ frame: frame(), develop: { ...BASE, effects } }, PROFILE, {}), slots = read(metadata).slots;
	assert.deepEqual(slots.map(slot => slot.stageIndex), [0, 1, 2, 3, 4, 5, null]);
	assert.deepEqual(metadata.stages.map(stage => stage.kind), ['noop', 'noop', 'defringe', 'optical-vignette', 'spatial', 'noop']);
	for (const slot of slots) { assert.equal(slot.incoming, metadata.descriptor); assert.equal(slot.output, metadata.descriptor); }
	assert.equal(metadata.peakWorkingBytes, 8 * 6 * 32);
});

test('completed metadata remains detached from later mutable recipe edits and reader never reflects impostors', () => {
	const params = { exposure: 1 }, mutableEffect = { id: 'captured', type: 'tone-ladder-v1', enabled: true, params };
	const effects = [mutableEffect], develop = { ...BASE, effects };
	const metadata = prepare({ frame: frame(), develop }, PROFILE, {}), before = JSON.stringify(metadata.authoredSlots);
	params.exposure = 9; mutableEffect.id = 'changed'; mutableEffect.enabled = false; effects.length = 0;
	Object.defineProperty(develop, 'effects', { get(): never { return assert.fail('Captured metadata must not reread external recipe.'); } });
	assert.equal(JSON.stringify(read(metadata).slots), before); assert.equal(metadata.develop.effects[0]!.id, 'captured');
	assert.equal(metadata.develop.effects[0]!.params.exposure, 1);
	let probes = 0;
	const hostile = new Proxy({}, { get() { probes++; throw new Error('get'); }, getOwnPropertyDescriptor() { probes++; throw new Error('own'); }, getPrototypeOf() { probes++; throw new Error('prototype'); } });
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	for (const value of [null, 1, hostile, revoked.proxy, { ...metadata }]) {
		assert.equal(isOwner(value), false); assert.throws(() => read(value), /owning|metadata/u);
	}
	assert.equal(probes, 0);
});

test('one legacy prefix plus the full 256-effect envelope retains every authored index within existing bounds', () => {
	const effects = Array.from({ length: 256 }, (_, index) => effect('tone-ladder-v1', `tone-${String(index)}`, {}, false));
	const metadata = prepare({ frame: frame(1, 1), develop: { ...BASE, effects, geometry: { ...BASE.geometry, flipHorizontal: true } } }, PROFILE, {});
	const slots = read(metadata).slots;
	assert.equal(slots.length, 257); assert.equal(metadata.stages.length, 257);
	assert.deepEqual(slots.map(slot => slot.stageIndex), Array.from({ length: 257 }, (_, index) => index));
	assert.deepEqual(slots.at(-1)!.identity, { origin: 'effect', effectIndex: 255, effectId: 'tone-255', effectType: 'tone-ladder-v1', enabled: false });
	assert.throws(() => prepare({ frame: frame(1, 1), develop: { ...BASE, effects: [...effects, effect('tone-ladder-v1', 'overflow')] } }, PROFILE, {}), /limit|effect|length|256/u);
});


test('the existing encoded-proxy disabled-family continuation retains its ordinary no-op stage and authored identity', () => {
	const metadata = prepareProxy({ frame: { descriptor: { schemaVersion: 1, width: 2, height: 1,
		sampleFormat: 'unorm8', transfer: 'srgb', primaries: 'srgb' } },
		develop: { ...BASE, effects: [effect('gaussian-blur', 'disabled-byte-only', {}, false)] } }, PROFILE, {});
	assert.deepEqual(metadata.stages, [{ kind: 'noop', id: 'disabled-byte-only' }]);
	assert.equal(read(metadata).slots.length, 1); assert.equal(read(metadata).slots[0]!.stageIndex, 0);
	assert.deepEqual(read(metadata).slots[0]!.identity, { origin: 'effect', effectIndex: 0,
		effectId: 'disabled-byte-only', effectType: 'gaussian-blur', enabled: false });
});
