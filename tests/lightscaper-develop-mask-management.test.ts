/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { manageImageDevelopMasksV1 } from '../src/common/editor/imaging/image-develop-mask-management-v1.ts';
import { normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';

// Retained scalar references are intentionally not body/source capabilities.
const BRUSH = `brush-mask-v1:2:1:${'a'.repeat(64)}`;
const LUT = Object.freeze({ storageKey: `lut-sha256:${'b'.repeat(64)}`, sha256: 'b'.repeat(64), byteLength: 80, size: 2,
	domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
function simple(id: string, kind: 'mask' | 'matte' = 'mask') {
	return { schemaVersion: 1, id, kind, inputs: [], nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle',
		x: 0.1, y: 0.2, width: 0.7, height: 0.6 }], outputNodeId: 'shape' };
}
function composed() {
	return { schemaVersion: 1, id: 'composed', kind: 'matte',
		inputs: [{ name: 'Brush', kind: 'alpha', sourceRef: BRUSH }, { name: 'Unused', kind: 'raster', sourceRef: 'external-retained-input' }],
		nodes: [{ id: 'a-alpha', kind: 'alpha', inputName: 'Brush' }, { id: 'b-raster', kind: 'raster', inputName: 'Unused', channel: 'luma' },
			{ id: 'c-linear', kind: 'linear-gradient', start: { x: -0.2, y: 0 }, end: { x: 1.1, y: 1 } },
			{ id: 'd-radial', kind: 'radial-gradient', center: { x: 0.3, y: 0.4 }, radius: { x: 0.6, y: 0.7 }, innerFraction: 0.2 },
			{ id: 'e-luminance', kind: 'luminance-range', lower: 0.1, upper: 0.9, falloff: 0.2 },
			{ id: 'f-color', kind: 'color-range', color: { r: 0.8, g: 0.2, b: 0.4 }, radius: 0.1, falloff: 0.3 },
			{ id: 'g-rectangle', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 },
			{ id: 'h-ellipse', kind: 'vector-shape', shape: 'ellipse', x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
			{ id: 'i-path', kind: 'vector-path', fillRule: 'even-odd', paths: [{ id: 'triangle', closed: true,
				points: [{ position: { x: 0, y: 0 }, inHandle: null, outHandle: null },
					{ position: { x: 1, y: 0 }, inHandle: null, outHandle: null }, { position: { x: 0, y: 1 }, inHandle: null, outHandle: null }] }] },
			{ id: 'j-feather', kind: 'feather', inputNodeId: 'c-linear', radius: 3 },
			{ id: 'k-invert', kind: 'invert', inputNodeId: 'e-luminance' },
			{ id: 'z-output', kind: 'boolean', operation: 'intersect', inputNodeIds: ['a-alpha', 'j-feather', 'k-invert'] }], outputNodeId: 'z-output' };
}
function recipe(processVersion: 1 | 2 = 2) {
	const effects = [createVideoEffect('detail-sharpen-v1', { id: 'detail', enabled: false, params: { amount: 37 } }),
		createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 0.2, cropWidth: 0.7 } }),
		createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 0.5 } }),
		processVersion === 2 ? { id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: LUT } }
			: createVideoEffect('dehaze-v1', { id: 'profile', enabled: false, params: { amount: 12 } }),
		createVideoEffect('tone-ladder-v1', { id: 'unrelated', params: { exposure: -0.5 } })];
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV1(), processVersion, effects,
		geometry: { crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 }, rotationDegrees: 23, flipHorizontal: true, flipVertical: false },
		masks: [composed(), simple('other'), simple('third', 'matte')], maskBindings: [{ effectId: 'tone', maskId: 'composed' },
			{ effectId: 'detail', maskId: 'other' }, { effectId: 'profile', maskId: 'third' }, { effectId: 'unrelated', maskId: 'other' }] });
}

test('duplicate keeps every composed/matte node, unused input and brush identity while starting unbound', () => {
	const input = structuredClone(recipe()), before = structuredClone(input);
	const result = manageImageDevelopMasksV1(input, { type: 'duplicate', maskId: 'composed', duplicateId: 'copy' });
	assert.deepEqual(result.masks.find(mask => mask.id === 'copy'), { ...before.masks.find(mask => mask.id === 'composed'), id: 'copy' });
	assert.deepEqual(result.masks.filter(mask => mask.id !== 'copy'), before.masks); assert.deepEqual(result.maskBindings, before.maskBindings);
	assert.equal(result.maskBindings.some(binding => binding.maskId === 'copy'), false); assert.deepEqual(input, before);
	assert.deepEqual(result.effects, before.effects); assert.deepEqual(result.geometry, before.geometry); assert.equal(result.processVersion, 2);
	assert.equal(result.masks.find(mask => mask.id === 'copy')?.inputs[0]?.sourceRef, BRUSH);
	assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.masks), true);
	Reflect.set(input.masks[0]!, 'kind', 'mask'); assert.equal(result.masks.find(mask => mask.id === 'copy')?.kind, 'matte');
});

test('duplicate is shape-independent and preserves both process versions and scalar graph definitions', () => {
	const nodes = composed().nodes.filter(node => ['linear-gradient', 'radial-gradient', 'luminance-range', 'color-range', 'vector-shape'].includes(node.kind));
	for (const processVersion of [1, 2] as const) for (const node of nodes) {
		const input = normalizeImageDevelopStateV1OrV2({ ...recipe(processVersion), masks: [{ schemaVersion: 1, id: 'selected', kind: 'mask',
			inputs: [], nodes: [node], outputNodeId: node.id }], maskBindings: [] });
		const result = manageImageDevelopMasksV1(input, { type: 'duplicate', maskId: 'selected', duplicateId: 'copy' });
		assert.deepEqual(result.masks, [{ ...input.masks[0], id: 'copy' }, input.masks[0]]);
		assert.deepEqual(result.effects, input.effects); assert.deepEqual(result.geometry, input.geometry); assert.equal(result.processVersion, processVersion);
	}
});

test('remove retains unrelated graphs and bindings and removing the last graph leaves a valid empty recipe', () => {
	const input = recipe(), result = manageImageDevelopMasksV1(input, { type: 'remove', maskId: 'composed' });
	assert.deepEqual(result, { ...input, masks: input.masks.filter(mask => mask.id !== 'composed'),
		maskBindings: input.maskBindings.filter(binding => binding.maskId !== 'composed') });
	const last = normalizeImageDevelopStateV1OrV2({ ...input, masks: [input.masks[0]], maskBindings: [{ effectId: 'tone', maskId: 'composed' }] });
	assert.deepEqual(manageImageDevelopMasksV1(last, { type: 'remove', maskId: 'composed' }), { ...last, masks: [], maskBindings: [] });
});

test('bindings claims detail and LUT effects without toggling disabled effects or changing effect order, geometry or unrelated binding', () => {
	const input = recipe(), result = manageImageDevelopMasksV1(input, { type: 'bindings', maskId: 'composed', effectIds: ['profile', 'detail'] });
	assert.deepEqual(result.maskBindings, [{ effectId: 'detail', maskId: 'composed' }, { effectId: 'profile', maskId: 'composed' },
		{ effectId: 'unrelated', maskId: 'other' }]);
	assert.deepEqual(result.masks, input.masks); assert.deepEqual(result.effects, input.effects); assert.deepEqual(result.geometry, input.geometry);
	assert.equal(result.processVersion, input.processVersion); assert.equal(result.effects[0]?.enabled, false); assert.equal(result.effects[3]?.enabled, false);
	assert.deepEqual(input.maskBindings, recipe().maskBindings);
});

test('empty bindings removes only selected uses; unchanged bindings remain normalized and serializable', () => {
	const input = recipe(), result = manageImageDevelopMasksV1(input, { type: 'bindings', maskId: 'other', effectIds: [] });
	assert.deepEqual(result.maskBindings, [{ effectId: 'profile', maskId: 'third' }, { effectId: 'tone', maskId: 'composed' }]);
	assert.deepEqual(manageImageDevelopMasksV1(input, { type: 'bindings', maskId: 'other', effectIds: ['unrelated', 'detail'] }), input);
	assert.deepEqual(normalizeImageDevelopStateV1OrV2(JSON.parse(JSON.stringify(result))), result);
});

test('invalid or missing IDs, duplicate identities and geometry bindings refuse without changing the source recipe', () => {
	const input = recipe(), before = structuredClone(input);
	for (const command of [{ type: 'duplicate', maskId: 'composed', duplicateId: 'other' }, { type: 'duplicate', maskId: 'composed', duplicateId: 'composed' },
		{ type: 'duplicate', maskId: 'missing', duplicateId: 'copy' }, { type: 'duplicate', maskId: 'composed', duplicateId: 'bad id' },
		{ type: 'remove', maskId: 'missing' }, { type: 'remove', maskId: '' }, { type: 'bindings', maskId: 'missing', effectIds: [] },
		{ type: 'bindings', maskId: 'composed', effectIds: ['missing'] }, { type: 'bindings', maskId: 'composed', effectIds: ['tone', 'tone'] },
		{ type: 'bindings', maskId: 'composed', effectIds: ['crop'] }]) {
		assert.throws(() => manageImageDevelopMasksV1(input, command)); assert.deepEqual(input, before);
	}
});

test('closed commands reject future operations, extra capabilities, sparse or oversized effect arrays and unsupported develop versions', () => {
	const input = recipe(), sparse: unknown[] = ['tone']; sparse.length = 2;
	for (const command of [null, [], { type: 'rename', maskId: 'composed', name: 'Changed' }, { type: 'remove' },
		{ type: 'remove', maskId: 'composed', source: {} }, { type: 'duplicate', maskId: 'composed', duplicateId: 'copy', effectIds: [] },
		{ type: 'bindings', maskId: 'composed', effectIds: sparse }, { type: 'bindings', maskId: 'composed', effectIds: Array(257).fill('tone') }]) {
		assert.throws(() => manageImageDevelopMasksV1(input, command));
	}
	assert.throws(() => manageImageDevelopMasksV1({ ...input, processVersion: 3 }, { type: 'remove', maskId: 'composed' }));
	assert.throws(() => manageImageDevelopMasksV1({ ...input, source: {} }, { type: 'remove', maskId: 'composed' }));
});

test('accessors and user conversion hooks are refused without invoking them or mutating caller arrays', () => {
	const input = recipe(); let calls = 0;
	const command = { type: 'remove', get maskId() { calls++; return 'composed'; } };
	assert.throws(() => manageImageDevelopMasksV1(input, command));
	const ids = ['tone']; Object.defineProperty(ids, '0', { enumerable: true, get() { calls++; return 'tone'; } });
	assert.throws(() => manageImageDevelopMasksV1(input, { type: 'bindings', maskId: 'composed', effectIds: ids }));
	const hostile = { ...input, get masks() { calls++; return input.masks; } };
	assert.throws(() => manageImageDevelopMasksV1(hostile, { type: 'remove', maskId: 'composed' }));
	assert.throws(() => manageImageDevelopMasksV1(input, { type: 'remove', maskId: { toString() { calls++; return 'composed'; } } }));
	assert.throws(() => manageImageDevelopMasksV1(input, { type: 'remove', maskId: 'composed', toJSON() { calls++; return {}; } }));
	assert.equal(calls, 0); assert.deepEqual(input, recipe());
});

test('64 graph and 256 effect limits admit their exact boundary and refuse growth or oversized input', () => {
	const baseline = recipe(), masks = Array.from({ length: 63 }, (_, index) => simple(`mask-${String(index)}`));
	const input = normalizeImageDevelopStateV1OrV2({ ...baseline, masks, maskBindings: [] });
	const full = manageImageDevelopMasksV1(input, { type: 'duplicate', maskId: 'mask-0', duplicateId: 'last' }); assert.equal(full.masks.length, 64);
	assert.throws(() => manageImageDevelopMasksV1(full, { type: 'duplicate', maskId: 'last', duplicateId: 'overflow' }));
	assert.throws(() => manageImageDevelopMasksV1({ ...baseline, masks: [...masks, simple('last'), simple('overflow')], maskBindings: [] }, { type: 'remove', maskId: 'mask-0' }));
	const effects = Array.from({ length: 256 }, (_, index) => createVideoEffect('tone-ladder-v1', { id: `effect-${String(index)}`, enabled: index % 2 === 0 }));
	const large = normalizeImageDevelopStateV1OrV2({ ...baseline, effects, masks: [simple('selected')], maskBindings: [] });
	const effectIds = effects.map(effect => effect.id), bound = manageImageDevelopMasksV1(large, { type: 'bindings', maskId: 'selected', effectIds });
	assert.equal(bound.maskBindings.length, 256); assert.deepEqual(bound.effects, large.effects); assert.deepEqual(effectIds, effects.map(effect => effect.id));
	assert.throws(() => manageImageDevelopMasksV1({ ...large, effects: [...effects, createVideoEffect('tone-ladder-v1', { id: 'overflow' })] }, { type: 'remove', maskId: 'selected' }));
});
