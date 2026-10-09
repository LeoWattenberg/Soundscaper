/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { copyImageDevelopSettingsV1, normalizeImageDevelopSettingsPacketV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { copyImageDevelopSettingsV2, normalizeImageDevelopSettingsPacketV2, normalizeImageDevelopSettingsPacketV1OrV2,
	mergeImageDevelopSettingsV2, adjustImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';

const all = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
const lutOnly = { effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: true };
const ref = (digit = '4') => ({ storageKey: `lut-sha256:${digit.repeat(64)}`, sha256: digit.repeat(64), byteLength: 88,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
const lut = (id: string, enabled = true) => ({ id, type: 'cube-lut-profile-v1', enabled, params: { lut: ref() } });
const tone = (id: string, exposure = 0) => ({ id, type: 'tone-ladder-v1', enabled: true, params: { exposure } });
const state = (...effects: unknown[]) => normalizeImageDevelopStateV2({ ...defaultImageDevelopStateV1(), processVersion: 2, effects });
const copy = (develop: unknown, selection: typeof all | typeof lutOnly = all) => copyImageDevelopSettingsV2({ schemaVersion: 2, develop, selection });
const mask = (x: number) => ({ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'shape',
	nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x, y: 0, width: 0.5, height: 1 }] });

test('settings2 retain detached complete refs, disabled and neutral profiles in authored order', () => {
	const active = lut('a');
	const raw = { ...defaultImageDevelopStateV1(), processVersion: 2, effects: [active, tone('tone'), lut('b', false),
		{ ...lut('neutral'), params: { lut: null } }] };
	const packet = copy(raw);
	assert.equal(packet.schemaVersion, 2); assert.equal(packet.kind, 'photo-develop-settings');
	assert.deepEqual(packet.develop.effects.map(effect => effect.id), ['a', 'tone', 'b', 'neutral']);
	active.params.lut.domainMin[0] = -1;
	assert.deepEqual(packet.develop.effects[0]?.params.lut, ref());
	assert.deepEqual(packet.develop.effects[2]?.params.lut, ref()); assert.equal(packet.develop.effects[2]?.enabled, false);
	assert.equal(packet.develop.effects[3]?.params.lut, null);
	assert.ok(Object.isFrozen(packet.develop.effects[0]?.params.lut));
	assert.deepEqual(normalizeImageDevelopSettingsPacketV2(JSON.parse(JSON.stringify(packet)) as unknown), packet);
});

test('the schema dispatcher preserves literal legacy bytes and old owners refuse schema2/process2', () => {
	const old = copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(), selection: all });
	const golden = '{"schemaVersion":1,"kind":"photo-develop-settings","selection":{"effectTypes":"all","geometry":true,"localAdjustments":true},"develop":{"processVersion":1,"effects":[],"geometry":{"crop":null,"rotationDegrees":0,"flipHorizontal":false,"flipVertical":false},"masks":[],"maskBindings":[]}}';
	assert.equal(JSON.stringify(normalizeImageDevelopSettingsPacketV1OrV2(old)), golden);
	const successor = copy(defaultImageDevelopStateV1()); assert.equal(successor.develop.processVersion, 1);
	assert.throws(() => normalizeImageDevelopSettingsPacketV1(successor));
	assert.throws(() => copyImageDevelopSettingsV1({ schemaVersion: 1, develop: state(lut('lut')), selection: all }));
	for (const schemaVersion of [0, 3, '2', null]) assert.throws(() => normalizeImageDevelopSettingsPacketV1OrV2({ ...successor, schemaVersion }));
});

test('selected LUT groups retain every selected reference and cannot hide unrelated settings', () => {
	const packet = copy(state(tone('omitted'), lut('active'), lut('disabled', false)), lutOnly);
	assert.deepEqual(packet.develop.effects.map(effect => effect.id), ['active', 'disabled']);
	assert.throws(() => normalizeImageDevelopSettingsPacketV2({ ...packet, develop: state(tone('hidden'), ...packet.develop.effects) }), /selection/iu);
	assert.throws(() => normalizeImageDevelopSettingsPacketV2({ ...packet, develop: { ...packet.develop,
		geometry: { ...packet.develop.geometry, rotationDegrees: 5 } } }), /selection/iu);
	for (const effectTypes of [['cube-lut-profile-v1', 'cube-lut-profile-v1'], ['unknown'], ['cube-lut-profile-v2']]) {
		assert.throws(() => copy(state(), { ...lutOnly, effectTypes }));
	}
});

test('partial paste remaps real local IDs and preserves unselected order, masks and refs across repeat', () => {
	const target = normalizeImageDevelopStateV2({ ...state(tone('same'), lut('old')), masks: [mask(0)], maskBindings: [{ effectId: 'same', maskId: 'mask' }] });
	const donor = normalizeImageDevelopStateV2({ ...state(lut('same', false)), masks: [mask(0.5)], maskBindings: [{ effectId: 'same', maskId: 'mask' }] });
	const packet = copy(donor, lutOnly), result = mergeImageDevelopSettingsV2({ schemaVersion: 2, target, settings: packet });
	assert.deepEqual(result.effects[0], target.effects[0]); assert.equal(result.effects.length, 2);
	assert.notEqual(result.effects[1]?.id, 'same'); assert.deepEqual(result.effects[1]?.params.lut, ref());
	const binding = result.maskBindings.find(item => item.effectId === result.effects[1]?.id)!;
	assert.notEqual(binding.maskId, 'mask'); assert.equal(result.masks.length, 2);
	assert.deepEqual(mergeImageDevelopSettingsV2({ schemaVersion: 2, target: result, settings: packet }), result);
	const globals = copy(donor, { ...lutOnly, localAdjustments: false }); assert.deepEqual(globals.develop.effects, []);
});

test('paste promotes process1 only for an actual LUT instance and retains an existing process2 target', () => {
	const legacy = defaultImageDevelopStateV1();
	const numeric = copy({ ...legacy, effects: [tone('tone', 2)] });
	assert.equal(mergeImageDevelopSettingsV2({ schemaVersion: 2, target: legacy, settings: numeric }).processVersion, 1);
	for (const effect of [lut('lut'), lut('disabled', false), { ...lut('null'), params: { lut: null } }]) {
		assert.equal(mergeImageDevelopSettingsV2({ schemaVersion: 2, target: legacy, settings: copy(state(effect)) }).processVersion, 2);
	}
	const oldPacket = copyImageDevelopSettingsV1({ schemaVersion: 1, develop: legacy, selection: all });
	assert.equal(mergeImageDevelopSettingsV2({ schemaVersion: 2, target: state(lut('old')), settings: oldPacket }).processVersion, 2);
	const relative = adjustImageDevelopSettingsV2({ schemaVersion: 2, target: state(lut('resource')), effectType: 'tone-ladder-v1', changes: { exposure: 0.5 } });
	assert.deepEqual(relative.effects[0]?.params.lut, ref()); assert.equal(relative.effects[1]?.params.exposure, 0.5);
	assert.equal(adjustImageDevelopSettingsV2({ schemaVersion: 2, target: legacy, effectType: 'tone-ladder-v1', changes: { exposure: 1 } }).processVersion, 1);
	assert.deepEqual(adjustImageDevelopSettingsV2({ schemaVersion: 2, target: relative, effectType: 'tone-ladder-v1', changes: { exposure: 0 } }), relative);
});

test('closed settings refuse external mask media, accessors, raw bodies and merged effect overflow', () => {
	const external = { ...state(lut('lut')), masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask',
		inputs: [{ name: 'image', sourceRef: 'external', kind: 'raster' }], nodes: [{ id: 'node', kind: 'raster', inputName: 'image', channel: 'luma' }], outputNodeId: 'node' }],
		maskBindings: [{ effectId: 'lut', maskId: 'mask' }] };
	assert.throws(() => copy(external), /authenticated/iu);
	let reads = 0; const accessor = Object.defineProperty({ schemaVersion: 2, selection: all }, 'develop', { enumerable: true, get() { reads++; return state(); } });
	assert.throws(() => copyImageDevelopSettingsV2(accessor)); assert.equal(reads, 0);
	assert.throws(() => copy({ ...state(), effects: [{ ...lut('lut'), params: { lut: ref(), body: 'raw cube' } }] }));
	const target = state(...Array.from({ length: 256 }, (_, index) => tone(`tone-${String(index)}`)));
	assert.throws(() => mergeImageDevelopSettingsV2({ schemaVersion: 2, target, settings: copy(state(lut('new')), lutOnly) }));
});

test('legal per-mask geometry cannot overflow the unchanged two-MiB complete settings body', () => {
	const points = Array.from({ length: 16_384 }, () => ({ position: { x: 0.5, y: 0.5 }, inHandle: null, outHandle: null }));
	const masks = Array.from({ length: 3 }, (_, index) => ({ schemaVersion: 1, id: `mask-${String(index)}`, kind: 'mask', inputs: [],
		outputNodeId: 'path', nodes: [{ id: 'path', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true, points }] }] }));
	const source = { ...state(lut('lut')), masks };
	assert.ok(Buffer.byteLength(JSON.stringify(source)) > 2_097_152);
	assert.throws(() => copy(source), /byte budget/iu);
	assert.equal(source.masks.length, 3); assert.deepEqual(source.effects[0]?.params.lut, ref());
});
