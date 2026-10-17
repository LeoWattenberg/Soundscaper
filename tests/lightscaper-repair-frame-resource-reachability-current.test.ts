/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { createImageDevelopResourceReachabilityCurrentV1 } from '../src/common/editor/imaging/image-develop-resource-reachability-current-v1.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';

// Root qualified these scalar controls through the actual product collector
// before the shared successor supplied genuine finished-packet merge.
const create = createImageDevelopResourceReachabilityCurrentV1;
const sha = (index: number) => index.toString(16).padStart(64, '0');
function brush(index: number, width = 1): BrushMaskResourceReferenceV1 {
	return { storageKey: `brush-mask-v1:${width}:1:${sha(index)}`, sha256: sha(index), width, height: 1, byteLength: 16 + width };
}
function lut(index: number, size = 2): VideoCubeLutReferenceV1 {
	return { storageKey: `lut-sha256:${sha(index)}`, sha256: sha(index), byteLength: 73, size, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
function state(index = 1, width = 1) {
	return replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: lut(index) } }],
		masks: [{ schemaVersion: 2, id: 'named', name: 'Unbound named matte', kind: 'matte',
			inputs: [{ name: 'used', kind: 'alpha', sourceRef: brush(index, width).storageKey }, { name: 'unused', kind: 'raster', sourceRef: brush(index + 1).storageKey }],
			nodes: [{ id: 'out', kind: 'alpha', inputName: 'used' }], outputNodeId: 'out' }], maskBindings: [] },
	{ schemaVersion: 1, spots: [{ id: 'heal', mode: 'heal', enabled: false, source: { x: 0.2, y: 0.5 }, target: { x: 0.7, y: 0.5 }, radius: 0.15, feather: 0.5, opacity: 1 }] });
}

test('shared Current closure retains disabled LUT and every declared named/unbound/unused brush without repair or body authority', () => {
	const value = state(), closure = create(); closure.addDevelop(value); closure.addDevelop(value);
	const result = closure.finish(); assert.deepEqual(result, { luts: [lut(1)], brushes: [brush(1), brush(2)] });
	assert.deepEqual(Object.keys(result).sort(), ['brushes', 'luts']); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.luts));
	assert.ok(Object.isFrozen(result.brushes)); assert.ok(Object.isFrozen(result.brushes[0])); assert.equal(closure.finish(), result);
	assert.throws(() => closure.addDevelop(defaultImageDevelopStateV1()), /sealed/iu);
});

test('closed Current admission detaches declarations and rejects future records or accessors before invoking getters', () => {
	const closure = create(), input = structuredClone(state()); closure.addDevelop(input); let getters = 0;
	Reflect.set(input.masks[0]!.inputs[0]!, 'sourceRef', brush(99).storageKey);
	const accessor = Object.defineProperty({ ...state(5) }, 'masks', { enumerable: true, get() { getters++; return state(5).masks; } });
	for (const value of [accessor, { ...state(5), processVersion: 4 }, { ...state(5), pixels: new Uint8Array(4) }, { ...state(5), [Symbol('body')]: true }]) assert.throws(() => closure.addDevelop(value));
	assert.equal(getters, 0); assert.deepEqual(closure.finish(), { luts: [lut(1)], brushes: [brush(1), brush(2)] });
});

test('failed mixed recipe merges neither earlier LUT identity nor brush references and preserves canonical conflict refusal', () => {
	const closure = create(); closure.addDevelop(state(10));
	const invalid = { ...state(20), masks: state(20).masks.map(mask => ({ ...mask,
		inputs: [...mask.inputs, { name: 'future', kind: 'alpha', sourceRef: `brush-mask-v2:1:1:${sha(30)}` }] })) };
	assert.throws(() => closure.addDevelop(invalid));
	const valid = normalizeImageDevelopStateCurrentV1({ ...state(20), effects: [{ id: 'other', type: 'cube-lut-profile-v1', enabled: false, params: { lut: lut(20, 3) } }] });
	closure.addDevelop(valid); assert.throws(() => closure.addDevelop(state(10, 2)), /conflict/iu);
	assert.deepEqual(closure.finish(), { luts: [lut(10), lut(20, 3)], brushes: [brush(10), brush(11), brush(20), brush(21)] });
});

test('generic resource closure parses reserved future brush namespaces but grants no identity to unrelated source IDs', () => {
	const closure = create(), value = normalizeImageDevelopStateCurrentV1({ ...state(1), effects: [], masks: state(1).masks.map(mask => ({ ...mask,
		inputs: mask.inputs.map(input => ({ ...input, sourceRef: 'other-source' })) })) });
	closure.addDevelop(value); assert.deepEqual(closure.finish(), { luts: [], brushes: [] });
	for (const sourceRef of ['brush-mask-future', `brush-mask-v2:1:1:${sha(1)}`, `brush-mask-v1:01:1:${sha(1)}`]) {
		const invalid = { ...state(1), masks: state(1).masks.map(mask => ({ ...mask, inputs: mask.inputs.map(input => ({ ...input, sourceRef })) })) };
		assert.throws(() => create().addDevelop(invalid));
	}
});

test('genuine finished scalar collectors merge atomically, deduplicate and retain conflicts without caller callbacks', () => {
	const target = create(), packet = create(); target.addDevelop(state(1)); packet.addDevelop(state(3));
	assert.equal(typeof target.merge, 'function'); assert.throws(() => target.merge(packet), /finish|sealed/iu);
	packet.finish(); target.merge(packet); target.merge(packet);
	const conflicting = create(); conflicting.addDevelop(state(7)); conflicting.addDevelop(state(1, 2)); conflicting.finish();
	assert.throws(() => target.merge(conflicting), /conflict/iu);
	assert.deepEqual(target.finish(), { luts: [lut(1), lut(3)], brushes: [brush(1), brush(2), brush(3), brush(4)] });
});

test('forged collector or snapshots never invoke supplied metadata hooks and cannot inject a body or alpha Map', () => {
	const target = create(); assert.equal(typeof target.merge, 'function'); let traps = 0;
	const forged = new Proxy({}, { get() { traps++; throw new Error('Borrowed method'); }, ownKeys() { traps++; return []; },
		getOwnPropertyDescriptor() { traps++; throw new Error('Borrowed metadata'); } });
	for (const value of [forged, { luts: [lut(1)], brushes: [brush(1)] }, new Map([['paint', new Uint8Array(1)]]), { finish() { traps++; return {}; } }]) assert.throws(() => target.merge(value));
	assert.equal(traps, 0); assert.deepEqual(target.finish(), { luts: [], brushes: [] });
});

test('combined4094 scalar references remain accepted while an extra LUT refuses atomically without a summed-body budget', () => {
	const masks = Array.from({ length: 16 }, (_, group) => ({ schemaVersion: 1, id: `mask-${group}`, kind: 'mask',
		inputs: Array.from({ length: group === 15 ? 254 : 256 }, (_, offset) => ({ name: `input-${offset}`, kind: 'alpha', sourceRef: brush(group * 256 + offset).storageKey })),
		nodes: [{ id: 'out', kind: 'alpha', inputName: 'input-0' }], outputNodeId: 'out' }));
	const value = replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV1(), processVersion: 2, effects: [], masks, maskBindings: [] }, { schemaVersion: 1, spots: [] });
	const closure = create(); closure.addDevelop(value); assert.throws(() => closure.addDevelop({ ...state(9000), masks: [] }), /capacity/iu);
	const result = closure.finish(); assert.equal(result.brushes.length, 4094); assert.deepEqual(result.luts, []);
	assert.equal(result.brushes[0]!.storageKey, brush(0).storageKey); assert.equal(result.brushes.at(-1)!.storageKey, brush(4093).storageKey);
});

test('reentrant finish owns its sealed snapshot before a reflected Current recipe can mutate either ledger', () => {
	const closure = create(); let snapshot: ReturnType<typeof closure.finish> | undefined;
	const input = new Proxy(state(), { ownKeys(target) { snapshot = closure.finish(); return Reflect.ownKeys(target); } });
	assert.throws(() => closure.addDevelop(input), /sealed/iu); assert.deepEqual(snapshot, { luts: [], brushes: [] }); assert.equal(closure.finish(), snapshot);
});
