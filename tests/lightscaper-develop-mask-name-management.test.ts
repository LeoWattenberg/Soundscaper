/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { manageImageDevelopMasksV2 } from '../src/common/editor/imaging/image-develop-mask-management-v2.ts';
import { manageImageDevelopMasksV1 } from '../src/common/editor/imaging/image-develop-mask-management-v1.ts';
import { normalizeImageDevelopStateV1, defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { videoMaskMatteGraphComputationV1 } from '../src/common/editor/video-mask-matte-name-v2.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

const BRUSH = `brush-mask-v1:2:1:${'a'.repeat(64)}`;
function graph(id: string, withResource = false) {
	return { schemaVersion: 1, id, kind: 'matte',
		inputs: withResource ? [{ name: 'UnusedPaint', kind: 'alpha', sourceRef: BRUSH }] : [],
		nodes: [{ id: 'output', kind: 'linear-gradient', start: { x: -0.2, y: 0 }, end: { x: 1.2, y: 1 } }], outputNodeId: 'output' };
}
function recipe(processVersion: 1 | 2 = 1) {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV1(), processVersion,
		effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 0.5 } }),
			createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false, params: { amount: 37 } }),
			createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 0.2, cropWidth: 0.7 } })],
		geometry: { crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 }, rotationDegrees: 23, flipHorizontal: true, flipVertical: false },
		masks: [graph('selected'), graph('other', true)], maskBindings: [{ effectId: 'tone', maskId: 'selected' }, { effectId: 'detail', maskId: 'other' }] });
}

test('rename explicitly promotes a legacy recipe without changing any graph identity, rendering definition, effect or binding', () => {
	const input = recipe(), before = structuredClone(input);
	const result = manageImageDevelopMasksV2(input, { type: 'rename', maskId: 'selected', name: ' \tCafe\u0301 ' });
	assert.equal(result.processVersion, 2);
	assert.deepEqual(result, { ...before, processVersion: 2, masks: before.masks.map(mask => mask.id === 'selected'
		? { ...mask, schemaVersion: 2, name: 'Café' } : mask) });
	assert.deepEqual(result.masks.map(videoMaskMatteGraphComputationV1), input.masks);
	assert.deepEqual(result.effects, input.effects); assert.deepEqual(result.maskBindings, input.maskBindings);
	assert.deepEqual(input, before); assert.equal(Object.isFrozen(result), true);
	assert.equal(result.masks.find(mask => mask.id === 'other')?.inputs[0]?.sourceRef, BRUSH);
});

test('process2 explicitly admits mixed graph versions but process1 and legacy Rename remain strict', () => {
	const input = recipe(), selected = input.masks.find(mask => mask.id === 'selected')!;
	const named = { ...input, processVersion: 2, masks: [...input.masks.filter(mask => mask.id !== 'selected'),
		{ ...selected, schemaVersion: 2, name: 'Sky' }] };
	const result = normalizeImageDevelopStateV2(named);
	assert.deepEqual(result.masks.map(mask => mask.id), ['other', 'selected']);
	assert.deepEqual(normalizeImageDevelopStateV1OrV2(named), result);
	assert.throws(() => normalizeImageDevelopStateV1({ ...named, processVersion: 1 }));
	assert.throws(() => normalizeImageDevelopStateV1OrV2({ ...named, processVersion: 1 }));
	assert.throws(() => manageImageDevelopMasksV1(input, { type: 'rename', maskId: 'selected', name: 'Sky' }));
	assert.deepEqual(normalizeImageDevelopStateV1(input), input);
});

test('clearing a name restores just that graph V1 and retains the explicitly selected process2 recipe', () => {
	const baseline = recipe(), named = manageImageDevelopMasksV2(baseline, { type: 'rename', maskId: 'selected', name: 'Sky' });
	const cleared = manageImageDevelopMasksV2(named, { type: 'rename', maskId: 'selected', name: ' \t\n ' });
	assert.deepEqual(cleared, { ...baseline, processVersion: 2 });
	assert.equal(cleared.processVersion, 2); assert.equal(Object.hasOwn(cleared.masks.find(mask => mask.id === 'selected')!, 'name'), false);
	assert.deepEqual(manageImageDevelopMasksV2(named, { type: 'rename', maskId: 'selected', name: '' }), cleared);
});

test('successor legacy commands preserve names and resource references, duplicate starts unbound and bindings claim effects', () => {
	const first = manageImageDevelopMasksV2(recipe(2), { type: 'rename', maskId: 'selected', name: 'Sky' });
	const named = manageImageDevelopMasksV2(first, { type: 'rename', maskId: 'other', name: 'Paint' });
	const copy = manageImageDevelopMasksV2(named, { type: 'duplicate', maskId: 'other', duplicateId: 'copy' });
	assert.deepEqual(copy.masks.find(mask => mask.id === 'copy'), { ...named.masks.find(mask => mask.id === 'other'), id: 'copy' });
	assert.equal(copy.maskBindings.some(binding => binding.maskId === 'copy'), false);
	const bound = manageImageDevelopMasksV2(copy, { type: 'bindings', maskId: 'copy', effectIds: ['tone', 'detail'] });
	assert.deepEqual(bound.masks, copy.masks); assert.deepEqual(bound.effects, named.effects);
	assert.deepEqual(bound.maskBindings, [{ effectId: 'detail', maskId: 'copy' }, { effectId: 'tone', maskId: 'copy' }]);
	const unbound = manageImageDevelopMasksV2(bound, { type: 'bindings', maskId: 'copy', effectIds: [] });
	assert.deepEqual(unbound.masks, bound.masks); assert.deepEqual(unbound.maskBindings, []);
	const removed = manageImageDevelopMasksV2(copy, { type: 'remove', maskId: 'other' });
	assert.deepEqual(removed.masks, copy.masks.filter(mask => mask.id !== 'other'));
	assert.deepEqual(removed.maskBindings, copy.maskBindings.filter(binding => binding.maskId !== 'other'));
	assert.deepEqual(removed.geometry, named.geometry); assert.equal(removed.processVersion, 2);
});

test('names are display metadata and can duplicate without colliding with IDs, output IDs or bindings', () => {
	const first = manageImageDevelopMasksV2(recipe(), { type: 'rename', maskId: 'selected', name: 'Same label' });
	const result = manageImageDevelopMasksV2(first, { type: 'rename', maskId: 'other', name: 'Same label' });
	assert.deepEqual(result.masks.map(mask => mask.id), ['other', 'selected']);
	for (const mask of result.masks) { assert.equal(mask.schemaVersion, 2); if (mask.schemaVersion === 2) assert.equal(mask.name, 'Same label'); }
	assert.deepEqual(result.maskBindings, first.maskBindings);
	assert.deepEqual(normalizeImageDevelopStateV1OrV2(JSON.parse(JSON.stringify(result)) as unknown), result);
});

test('closed rename commands and inert primitive names refuse without hooks or mutations', () => {
	const input = recipe(), before = structuredClone(input); let calls = 0;
	const accessor = { type: 'rename', maskId: 'selected', get name() { calls++; return 'Sky'; } };
	const conversion = { toString() { calls++; return 'Sky'; } };
	for (const command of [accessor, { type: 'rename', maskId: 'selected', name: conversion },
		{ type: 'rename', maskId: 'selected' }, { type: 'rename', maskId: 'missing', name: 'Sky' },
		{ type: 'rename', maskId: 'bad id', name: 'Sky' }, { type: 'rename', maskId: 'selected', name: null },
		{ type: 'rename', maskId: 'selected', name: 'Sky', source: {} },
		{ type: 'rename', maskId: 'selected', name: 'Sky', effectIds: [] },
		{ type: 'future', maskId: 'selected', name: 'Sky' }]) {
		assert.throws(() => manageImageDevelopMasksV2(input, command)); assert.deepEqual(input, before);
	}
	assert.throws(() => manageImageDevelopMasksV2({ ...input, get masks() { calls++; return input.masks; } },
		{ type: 'rename', maskId: 'selected', name: 'Sky' }));
	assert.equal(calls, 0);
});

test('new graph and name admission retains legacy graph/effect bounds and geometry-binding refusal', () => {
	const baseline = recipe(2), masks = Array.from({ length: 64 }, (_, index) => graph(`mask-${String(index)}`));
	const full = normalizeImageDevelopStateV2({ ...baseline, masks, maskBindings: [] });
	const result = manageImageDevelopMasksV2(full, { type: 'rename', maskId: 'mask-0', name: 'a'.repeat(256) });
	assert.equal(result.masks.length, 64); assert.deepEqual(result.effects, full.effects);
	assert.throws(() => manageImageDevelopMasksV2(result, { type: 'duplicate', maskId: 'mask-0', duplicateId: 'overflow' }));
	assert.throws(() => manageImageDevelopMasksV2(full, { type: 'rename', maskId: 'mask-0', name: 'a'.repeat(257) }));
	assert.throws(() => normalizeImageDevelopStateV2({ ...result, masks: [...result.masks, graph('overflow')] }));
	assert.throws(() => manageImageDevelopMasksV2(recipe(), { type: 'bindings', maskId: 'selected', effectIds: ['crop'] }));
	assert.throws(() => manageImageDevelopMasksV2({ ...baseline, processVersion: 3 }, { type: 'rename', maskId: 'selected', name: 'Sky' }));
});
