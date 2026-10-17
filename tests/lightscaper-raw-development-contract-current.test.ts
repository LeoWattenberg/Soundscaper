/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { IMAGE_DEVELOP_LIMITS_V1 } from '../src/common/editor/imaging/image-develop-contract-v1.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV2, normalizeImageDevelopStateV1OrV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { normalizeImageDevelopRawDevelopmentV1 } from '../src/common/editor/imaging/image-develop-raw-development-v1.ts';
import { normalizeImageDevelopStateThroughV3 } from '../src/common/editor/imaging/image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateV4, normalizeImageDevelopStateThroughV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { setImageDevelopRawDevelopmentCurrentV1 } from '../src/common/editor/imaging/image-develop-raw-development-current-v1.ts';

const SHA = 'a'.repeat(64), BRUSH = `brush-mask-v1:2:1:${'b'.repeat(64)}`;
const RAW = { schemaVersion: 1, mode: 'recovery' };
const emptyRepairs = () => ({ schemaVersion: 1, spots: [] });
function repaired() {
	return normalizeImageDevelopStateV3({ ...defaultImageDevelopStateV1(), processVersion: 3,
		effects: [createVideoEffect('tone-ladder-v1', { id: 'local', params: { exposure: 1 } }),
			{ id: 'retained-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: {
				storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: 83, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }],
		geometry: { crop: { x: .2, y: 0, width: .8, height: 1 }, rotationDegrees: 90, flipHorizontal: true, flipVertical: false },
		masks: [{ schemaVersion: 2, id: 'named', name: 'Retained paint', kind: 'matte',
			inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: BRUSH }, { name: 'Unused', kind: 'alpha', sourceRef: BRUSH }],
			nodes: [{ id: 'paint', kind: 'alpha', inputName: 'Paint' }], outputNodeId: 'paint' }],
		maskBindings: [{ effectId: 'local', maskId: 'named' }], repairs: { schemaVersion: 1, spots: [
			{ id: 'clone', mode: 'clone', enabled: true, target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: .25, opacity: .5 },
			{ id: 'disabled-heal', mode: 'heal', enabled: false, target: { x: .4, y: .5 }, source: { x: .1, y: .5 }, radius: .2, feather: 0, opacity: 0 }] } });
}
function fourth() { return { ...repaired(), processVersion: 4, rawDevelopment: { ...RAW } }; }
function oldStates() {
	const third = repaired();
	return [defaultImageDevelopStateV1(), normalizeImageDevelopStateV2({ processVersion: 2,
		effects: third.effects, geometry: third.geometry, masks: third.masks, maskBindings: third.maskBindings }), third];
}

test('process4 carries exactly one fixed RAW mode beside complete unchanged repair and resource metadata', () => {
	const input = fourth(), before = structuredClone(input), result = normalizeImageDevelopStateV4(input);
	assert.deepEqual(result, before); assert.equal(result.processVersion, 4);
	assert.deepEqual(normalizeImageDevelopStateThroughV4(input), result);
	assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.rawDevelopment));
	assert.ok(Object.isFrozen(result.repairs.spots[0]!.source)); assert.ok(Object.isFrozen(result.masks[0]!.inputs));
	assert.notEqual(result.rawDevelopment, input.rawDevelopment); assert.notEqual(result.repairs, input.repairs);
	assert.equal(result.effects[1]!.enabled, false); assert.equal(result.masks[0]!.inputs[1]!.sourceRef, BRUSH);
	input.rawDevelopment.mode = 'canonical'; assert.deepEqual(result, before); assert.deepEqual(input.repairs, before.repairs);
	assert.equal(Object.hasOwn(result.rawDevelopment, 'exposureScale'), false);
});

test('the new through4 reader preserves old canonical bytes while every permanent and existing Current reader stays strict', () => {
	for (const value of oldStates()) {
		const wire = JSON.stringify(value);
		assert.equal(JSON.stringify(normalizeImageDevelopStateThroughV3(value)), wire);
		assert.equal(JSON.stringify(normalizeImageDevelopStateThroughV4(value)), wire);
		assert.equal(JSON.stringify(normalizeImageDevelopStateCurrentV1(value)), wire);
		assert.equal(Object.hasOwn(value, 'rawDevelopment'), false);
		assert.throws(() => normalizeImageDevelopStateV4(value));
	}
	const value = fourth();
	for (const reader of [normalizeImageDevelopStateV1, normalizeImageDevelopStateV2, normalizeImageDevelopStateV1OrV2,
		normalizeImageDevelopStateV3, normalizeImageDevelopStateThroughV3, normalizeImageDevelopStateCurrentV1]) assert.throws(() => reader(value));
});

test('explicit headroom or recovery promotes only the recipe and canonical is a byte-exact old-state no-op', () => {
	for (const value of oldStates()) {
		const before = JSON.stringify(value), canonical = setImageDevelopRawDevelopmentCurrentV1(value, { schemaVersion: 1, mode: 'canonical' });
		assert.equal(JSON.stringify(canonical), before); assert.equal(canonical.processVersion, value.processVersion);
		for (const mode of ['headroom', 'recovery'] as const) {
			const changed = setImageDevelopRawDevelopmentCurrentV1(value, { schemaVersion: 1, mode });
			assert.deepEqual(changed, { ...value, processVersion: 4, repairs: value.processVersion === 3 ? value.repairs : emptyRepairs(), rawDevelopment: { schemaVersion: 1, mode } });
			assert.equal(JSON.stringify(value), before);
		}
	}
});

test('process4 remains sticky across all fixed modes and repeated edits preserve every unrelated group', () => {
	const original = normalizeImageDevelopStateV4(fourth()), wire = JSON.stringify(original);
	for (const mode of ['canonical', 'headroom', 'recovery'] as const) {
		const setting = { schemaVersion: 1, mode }, changed = setImageDevelopRawDevelopmentCurrentV1(original, setting);
		assert.equal(changed.processVersion, 4); assert.deepEqual(changed, { ...original, rawDevelopment: setting });
		assert.equal(JSON.stringify(setImageDevelopRawDevelopmentCurrentV1(changed, setting)), JSON.stringify(changed));
		assert.equal(JSON.stringify(original), wire); assert.ok(Object.isFrozen(changed));
	}
});

test('RAW mode metadata is closed own data and never accepts native processing options or invokes hooks', () => {
	let invoked = 0;
	for (const mode of ['canonical', 'headroom', 'recovery']) assert.deepEqual(normalizeImageDevelopRawDevelopmentV1({ schemaVersion: 1, mode }), { schemaVersion: 1, mode });
	for (const value of [null, [], {}, { schemaVersion: 2, mode: 'recovery' }, { schemaVersion: 1, mode: 'highlight-recovery-v1' },
		{ schemaVersion: 1, mode: { toString() { invoked++; return 'recovery'; } } }, { ...RAW, exposureScale: 2 }, { ...RAW, decoder: 'libraw' },
		{ ...RAW, rawFlip: 0 }, { ...RAW, pixels: Uint8Array.of(1) }, { ...RAW, enabled: false }, { ...RAW, [Symbol('extra')]: true },
		Object.create(RAW) as unknown, Object.defineProperty({ ...RAW }, 'mode', { enumerable: true, get() { invoked++; return 'recovery'; } })]) {
		assert.throws(() => normalizeImageDevelopRawDevelopmentV1(value));
		assert.throws(() => normalizeImageDevelopStateV4({ ...fourth(), rawDevelopment: value }));
		assert.throws(() => setImageDevelopRawDevelopmentCurrentV1(defaultImageDevelopStateV1(), value));
	}
	assert.equal(invoked, 0);
});

test('through3 and through4 inspect only inert own processVersion when rejecting future or invalid versions', () => {
	let inspected = 0, invoked = 0;
	for (const version of [0, 5, '4', undefined, { valueOf() { invoked++; return 4; } }]) {
		const input = new Proxy({ processVersion: version }, {
			getOwnPropertyDescriptor(target, key) { if (key !== 'processVersion') inspected++; return Reflect.getOwnPropertyDescriptor(target, key); },
			ownKeys(target) { inspected++; return Reflect.ownKeys(target); },
		});
		assert.throws(() => normalizeImageDevelopStateThroughV3(input)); assert.throws(() => normalizeImageDevelopStateThroughV4(input));
	}
	for (const reader of [normalizeImageDevelopStateThroughV3, normalizeImageDevelopStateThroughV4]) {
		assert.throws(() => reader({ get processVersion() { invoked++; return 4; } }));
	}
	assert.equal(inspected, 0); assert.equal(invoked, 0);
});

test('process4 rejects incomplete or hostile envelopes and canonical editing cannot bypass full admission', () => {
	let invoked = 0;
	for (const key of ['processVersion', 'effects', 'geometry', 'masks', 'maskBindings', 'repairs', 'rawDevelopment']) {
		const missing: Record<string, unknown> = { ...fourth() }; Reflect.deleteProperty(missing, key);
		const accessor = Object.defineProperty({ ...fourth() }, key, { enumerable: true, get() { invoked++; return {}; } });
		for (const value of [missing, accessor]) {
			assert.throws(() => normalizeImageDevelopStateV4(value));
			assert.throws(() => setImageDevelopRawDevelopmentCurrentV1(value, { schemaVersion: 1, mode: 'canonical' }));
		}
	}
	for (const value of [{ ...fourth(), processVersion: 3 }, { ...fourth(), repairs: { schemaVersion: 2, spots: [] } },
		{ ...fourth(), maskBindings: [{ effectId: 'missing', maskId: 'named' }] }, { ...fourth(), body: new Blob() },
		{ ...fourth(), [Symbol('extra')]: true }, Object.create(fourth()) as unknown]) assert.throws(() => normalizeImageDevelopStateV4(value));
	assert.equal(invoked, 0);
});

function largeFourth(count: number) {
	const graph = (id: string, nodes: number) => {
		const nodeId = (index: number) => `${id}-${String(index)}-`.padEnd(128, 'x');
		return { schemaVersion: 2, id, name: 'n', kind: 'matte', inputs: [], outputNodeId: nodeId(0),
			nodes: Array.from({ length: nodes }, (_, index) => ({ id: nodeId(index), kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 })) };
	};
	const metadata = normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV1(), processVersion: 2,
		masks: [graph('a', 200), graph('b', 200), graph('c', 3000), graph('d', 3000), graph('e', count)] });
	return { ...metadata, processVersion: 4, repairs: emptyRepairs(), rawDevelopment: { ...RAW } };
}

test('process4 charges its complete canonical envelope against the unchanged two-MiB UTF8 budget', () => {
	const limit = IMAGE_DEVELOP_LIMITS_V1.maximumBytes; let lower = 1, upper = 4096;
	while (upper - lower > 1) {
		const middle = Math.floor((lower + upper) / 2);
		if (JSON.stringify(largeFourth(middle)).length <= limit) lower = middle; else upper = middle;
	}
	const value = largeFourth(lower); let remaining = limit - JSON.stringify(value).length;
	const masks = value.masks.map(mask => { const extra = Math.min(255, remaining); remaining -= extra; return { ...mask, name: 'n'.repeat(1 + extra) }; });
	assert.equal(remaining, 0);
	const boundary = { ...value, masks }, accepted = normalizeImageDevelopStateV4(boundary), wire = JSON.stringify(accepted);
	assert.equal(wire.length, limit); assert.equal(new TextEncoder().encode(wire).byteLength, limit);
	const unicode = { ...boundary, masks: boundary.masks.map((mask, index) => index === 0 ? { ...mask, name: `é${mask.name.slice(1)}` } : mask) };
	assert.equal(JSON.stringify(unicode).length, limit); assert.equal(new TextEncoder().encode(JSON.stringify(unicode)).byteLength, limit + 1);
	const { rawDevelopment: omitted, ...repairMetadata } = unicode; assert.equal(omitted.mode, 'recovery');
	assert.doesNotThrow(() => normalizeImageDevelopStateV3({ ...repairMetadata, processVersion: 3 }));
	assert.throws(() => normalizeImageDevelopStateV4(unicode), /byte|budget|MiB/iu);
	assert.throws(() => normalizeImageDevelopStateV4(largeFourth(upper)), /byte|budget|MiB/iu);
});
