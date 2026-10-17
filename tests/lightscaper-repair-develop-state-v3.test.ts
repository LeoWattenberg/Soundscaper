/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { IMAGE_DEVELOP_LIMITS_V1 } from '../src/common/editor/imaging/image-develop-contract-v1.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';

const SHA = 'a'.repeat(64), BRUSH = `brush-mask-v1:2:1:${'b'.repeat(64)}`;
const emptyRepairs = () => ({ schemaVersion: 1, spots: [] });
function spot(id = 'first') {
	return { id, mode: 'heal', enabled: true, target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15, feather: 0, opacity: 1 };
}
function graph() {
	return { schemaVersion: 2, id: 'named', name: 'Foreground', kind: 'matte',
		inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: BRUSH }, { name: 'Unused', kind: 'raster', sourceRef: 'external-unused' }],
		nodes: [{ id: 'paint', kind: 'alpha', inputName: 'Paint' },
			{ id: 'unused', kind: 'raster', inputName: 'Unused', channel: 'red' }], outputNodeId: 'paint' };
}
function full() {
	return { ...defaultImageDevelopStateV1(), processVersion: 3,
		effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }),
			{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: { storageKey: `lut-sha256:${SHA}`,
				sha256: SHA, byteLength: 83, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }],
		geometry: { crop: { x: 0.2, y: 0, width: 0.8, height: 1 }, rotationDegrees: 90, flipHorizontal: true, flipVertical: false },
		masks: [graph()], maskBindings: [{ effectId: 'tone', maskId: 'named' }],
		repairs: { schemaVersion: 1, spots: [spot(), { ...spot('second'), mode: 'clone', enabled: false, opacity: 0 }] } };
}
function metadata(value: { effects: unknown; geometry: unknown; masks: unknown; maskBindings: unknown }) {
	return { processVersion: 2, effects: value.effects, geometry: value.geometry, masks: value.masks, maskBindings: value.maskBindings };
}
function plain3() { return { ...defaultImageDevelopStateV1(), processVersion: 3, repairs: emptyRepairs() }; }

test('strict process3 has mandatory empty repairs and detached deeply frozen scalar state', () => {
	const input = plain3(), result = normalizeImageDevelopStateV3(input);
	assert.deepEqual(result, input); assert.equal(result.processVersion, 3);
	assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.repairs), true);
	assert.equal(Object.isFrozen(result.repairs.spots), true); assert.equal(Object.isFrozen(result.geometry), true);
	assert.notEqual(result, input); assert.notEqual(result.repairs, input.repairs);
	assert.deepEqual(normalizeImageDevelopStateCurrentV1(input), result);
});

test('process3 retains complete named and resource-bearing process2 metadata without granting any body authority', () => {
	const input = full(), before = structuredClone(input), legacy = normalizeImageDevelopStateV2(metadata(input));
	const result = normalizeImageDevelopStateV3(input);
	assert.deepEqual(result, { ...legacy, processVersion: 3, repairs: before.repairs });
	assert.equal(result.masks[0]?.schemaVersion, 2);
	assert.equal(result.masks[0]?.inputs.find(value => value.name === 'Paint')?.sourceRef, BRUSH);
	assert.equal(result.masks[0]?.inputs.find(value => value.name === 'Unused')?.sourceRef, 'external-unused');
	assert.equal(result.effects[1]?.enabled, false); assert.deepEqual(result.effects[1], legacy.effects[1]);
	assert.deepEqual(result.repairs.spots.map(value => value.id), ['first', 'second']);
	assert.equal(Object.isFrozen(result.repairs.spots[0]?.source), true);
	assert.equal(Object.isFrozen(result.masks[0]?.inputs), true); assert.deepEqual(input, before);
	input.repairs.spots[0]!.source.x = 0.9; input.masks[0]!.name = 'Changed'; input.masks[0]!.inputs[0]!.sourceRef = 'changed';
	assert.deepEqual(result, { ...legacy, processVersion: 3, repairs: before.repairs });
});

test('the current dispatcher preserves old owners and their exact canonical bytes without load-time promotion', () => {
	const v1 = defaultImageDevelopStateV1(), v2 = normalizeImageDevelopStateV2(metadata(full()));
	for (const value of [v1, v2]) {
		const result = normalizeImageDevelopStateCurrentV1(value);
		assert.equal(JSON.stringify(result), JSON.stringify(value)); assert.equal(result.processVersion, value.processVersion);
		assert.equal(Object.hasOwn(result, 'repairs'), false);
	}
	assert.equal(JSON.stringify(normalizeImageDevelopStateV1(v1)), JSON.stringify(v1));
	assert.equal(JSON.stringify(normalizeImageDevelopStateV2(v2)), JSON.stringify(v2));
});

test('strict process1 and process2 refuse all process3 repairs including empty and disabled definitions', () => {
	for (const value of [plain3(), full(), { ...plain3(), repairs: { schemaVersion: 1, spots: [{ ...spot(), enabled: false }] } }]) {
		assert.throws(() => normalizeImageDevelopStateV1(value));
		assert.throws(() => normalizeImageDevelopStateV2(value));
		assert.throws(() => normalizeImageDevelopStateV1OrV2(value));
	}
	for (const processVersion of [1, 2]) {
		const value = { ...plain3(), processVersion };
		assert.throws(() => normalizeImageDevelopStateCurrentV1(value));
		assert.throws(() => normalizeImageDevelopStateV3(value));
	}
});

test('current version selection reads inert own processVersion first and does not inspect unrelated metadata on refusal', () => {
	let inspected = 0, invoked = 0;
	for (const processVersion of [0, 4, '3', undefined, { valueOf() { invoked++; return 3; } }]) {
		const value = new Proxy({ processVersion }, {
			getOwnPropertyDescriptor(target, key) { if (key !== 'processVersion') inspected++; return Reflect.getOwnPropertyDescriptor(target, key); },
			ownKeys(target) { inspected++; return Reflect.ownKeys(target); },
		});
		assert.throws(() => normalizeImageDevelopStateCurrentV1(value));
	}
	assert.throws(() => normalizeImageDevelopStateCurrentV1({ get processVersion() { invoked++; return 3; } }));
	assert.equal(inspected, 0); assert.equal(invoked, 0);
});

test('process3 is a closed mandatory envelope and refuses accessors, inherited state and body capabilities', () => {
	let invoked = 0;
	for (const key of ['processVersion', 'effects', 'geometry', 'masks', 'maskBindings', 'repairs']) {
		const missing: Record<string, unknown> = { ...plain3() }; Reflect.deleteProperty(missing, key);
		assert.throws(() => normalizeImageDevelopStateV3(missing));
		const accessor = { ...plain3() }; Object.defineProperty(accessor, key, { enumerable: true, get() { invoked++; return {}; } });
		assert.throws(() => normalizeImageDevelopStateV3(accessor));
	}
	for (const value of [{ ...plain3(), body: Uint8Array.of(1) }, { ...plain3(), loadOriginal() { invoked++; } },
		{ ...plain3(), [Symbol('extra')]: true }, Object.create(plain3()) as unknown, null, []]) {
		assert.throws(() => normalizeImageDevelopStateV3(value));
		assert.throws(() => normalizeImageDevelopStateCurrentV1(value));
	}
	assert.equal(invoked, 0);
});

test('repair definitions use the existing closed ordered64-spot owner including inactive state', () => {
	const spots = Array.from({ length: 64 }, (_, index) => ({ ...spot(`spot-${String(index)}`), enabled: false }));
	const accepted = normalizeImageDevelopStateV3({ ...plain3(), repairs: { schemaVersion: 1, spots } });
	assert.deepEqual(accepted.repairs.spots.map(value => value.id), spots.map(value => value.id));
	for (const repairs of [{ schemaVersion: 2, spots: [] }, { schemaVersion: 1, spots: [...spots, spot('overflow')] },
		{ schemaVersion: 1, spots: [spot(), spot()] }, { schemaVersion: 1, spots: [{ ...spot(), source: { x: 2, y: 0.5 } }] },
		{ schemaVersion: 1, spots: [{ ...spot(), mode: 'future' }] }, { schemaVersion: 1, spots: [{ ...spot(), radius: 0 }] }]) {
		assert.throws(() => normalizeImageDevelopStateV3({ ...plain3(), repairs }));
	}
});

test('geometry, masks, bindings and LUT references retain strict process2 family admission', () => {
	const input = full(); let conversions = 0;
	const coercion = { toString() { conversions++; return BRUSH; } };
	for (const value of [{ ...input, geometry: { ...input.geometry, crop: { x: 0.5, y: 0, width: 1, height: 1 } } },
		{ ...input, maskBindings: [{ effectId: 'missing', maskId: 'named' }] },
		{ ...input, masks: [{ ...graph(), name: ' Noncanonical ' }] },
		{ ...input, masks: [{ ...graph(), inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: coercion }] }] },
		{ ...input, effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: { storageKey: 'wrong' } } }] }]) {
		assert.throws(() => normalizeImageDevelopStateV3(value));
	}
	assert.equal(conversions, 0);
});

test('only explicit repair replacement promotes process1 or process2 and preserves complete unrelated metadata', () => {
	for (const value of [defaultImageDevelopStateV1(), normalizeImageDevelopStateV2(metadata(full()))]) {
		const before = structuredClone(value), repairs = { schemaVersion: 1, spots: [spot()] };
		const result = replaceImageDevelopRepairSpotsV1(value, repairs);
		assert.deepEqual(result, { ...before, processVersion: 3, repairs });
		assert.deepEqual(value, before); assert.equal(Object.isFrozen(result.repairs.spots[0]), true);
		repairs.spots[0]!.target.x = 0.1; assert.equal(result.repairs.spots[0]?.target.x, 0.7);
		assert.equal(normalizeImageDevelopStateCurrentV1(value).processVersion, value.processVersion);
	}
});

test('explicit editing is sticky process3 for empty and disabled repairs and never removes unrelated state', () => {
	const original = normalizeImageDevelopStateV3(full());
	for (const repairs of [emptyRepairs(), { schemaVersion: 1, spots: [{ ...spot(), enabled: false, opacity: 0 }] }]) {
		const result = replaceImageDevelopRepairSpotsV1(original, repairs);
		assert.deepEqual(result, { ...original, repairs }); assert.equal(result.processVersion, 3);
		assert.equal(normalizeImageDevelopStateCurrentV1(result).processVersion, 3);
	}
	assert.equal(replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV1(), emptyRepairs()).processVersion, 3);
});

test('replacement cannot bypass existing malformed state or invoke repair coercion/accessors', () => {
	let invoked = 0;
	const repairs = { schemaVersion: 1, get spots() { invoked++; return []; } };
	assert.throws(() => replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV1(), repairs));
	assert.throws(() => replaceImageDevelopRepairSpotsV1({ ...plain3(), repairs: { schemaVersion: 4, spots: [] } }, emptyRepairs()));
	assert.throws(() => replaceImageDevelopRepairSpotsV1({ ...plain3(), resourceSource() { invoked++; } }, emptyRepairs()));
	assert.equal(invoked, 0);
});

function largeGraph(id: string, count: number, name: string) {
	const nodeId = (index: number) => `${id}-${String(index)}-`.padEnd(128, 'x');
	return { schemaVersion: 2, id, name, kind: 'matte', inputs: [],
		nodes: Array.from({ length: count }, (_, index) => ({ id: nodeId(index), kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 })),
		outputNodeId: nodeId(0) };
}
function large3(count: number, name = 'n'.repeat(256)) {
	return { ...plain3(), masks: [largeGraph('a', 200, name), largeGraph('b', 200, name),
		largeGraph('c', 3000, name), largeGraph('d', 3000, name), largeGraph('e', count, name)] };
}

test('process3 admits a valid near-two-MiB recipe and rejects canonical ASCII overflow without widening old readers', () => {
	const limit = IMAGE_DEVELOP_LIMITS_V1.maximumBytes; let lower = 1, upper = 4096;
	assert.ok(JSON.stringify(large3(lower)).length < limit); assert.ok(JSON.stringify(large3(upper)).length > limit);
	while (upper - lower > 1) {
		const middle = Math.floor((lower + upper) / 2);
		if (JSON.stringify(large3(middle)).length <= limit) lower = middle; else upper = middle;
	}
	const input = large3(lower), accepted = normalizeImageDevelopStateV3(input), wire = JSON.stringify(accepted);
	assert.ok(wire.length <= limit); assert.ok(limit - wire.length < 512);
	assert.equal(new TextEncoder().encode(wire).byteLength, wire.length);
	assert.throws(() => normalizeImageDevelopStateV3(large3(upper)), /byte|budget|MiB/iu);
	const old = normalizeImageDevelopStateV2(metadata(large3(upper)));
	assert.equal(JSON.stringify(normalizeImageDevelopStateCurrentV1(old)), JSON.stringify(old));
	const spots = Array.from({ length: 64 }, (_, index) => ({ ...spot(`spot-${String(index)}`), enabled: false }));
	assert.throws(() => replaceImageDevelopRepairSpotsV1(normalizeImageDevelopStateV2(metadata(input)), { schemaVersion: 1, spots }), /byte|budget|MiB/iu);
});

test('the process3 byte limit measures UTF8 after normalization rather than only UTF16 characters', () => {
	const limit = IMAGE_DEVELOP_LIMITS_V1.maximumBytes; let lower = 1, upper = 4096;
	while (upper - lower > 1) {
		const middle = Math.floor((lower + upper) / 2);
		if (JSON.stringify(large3(middle)).length <= limit) lower = middle; else upper = middle;
	}
	const raw = large3(lower, 'é'.repeat(256)), old = normalizeImageDevelopStateV2(metadata(raw));
	const canonical = { ...old, processVersion: 3, repairs: emptyRepairs() }, wire = JSON.stringify(canonical);
	assert.ok(wire.length <= limit); assert.ok(new TextEncoder().encode(wire).byteLength > limit);
	assert.throws(() => normalizeImageDevelopStateV3(raw), /byte|budget|MiB/iu);
	assert.throws(() => normalizeImageDevelopStateCurrentV1(raw), /byte|budget|MiB/iu);
});
