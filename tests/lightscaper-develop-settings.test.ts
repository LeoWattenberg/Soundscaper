/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { VideoEffectLeaf } from '../src/common/editor/project-media-types.ts';
import { defaultPhotoDevelopV1, normalizePhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { copyPhotoDevelopSettingsV1, mergePhotoDevelopSettingsV1, normalizePhotoDevelopSettingsPacketV1,
	adjustPhotoDevelopSettingsV1 } from '../src/lightscaper/controller/photo-develop-settings-v1.ts';

const effect = (id: string, type: string, params: Record<string, number> = {}): VideoEffectLeaf =>
	createVideoEffect(type, { id, params }) as VideoEffectLeaf;
const all = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
const globals = { effectTypes: 'all' as const, geometry: false, localAdjustments: false };
const settings = (...effects: VideoEffectLeaf[]) => normalizePhotoDevelopV1({ ...defaultPhotoDevelopV1(), effects });
const mask = (id: string, x = 0.5) => ({ schemaVersion: 1, id, kind: 'mask', inputs: [], outputNodeId: 'path',
	nodes: [{ id: 'path', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true,
		points: [0.1, 0.5, 0.9].map(y => ({ position: { x, y }, inHandle: null, outHandle: null })) }] }] });

test('Full settings copy is detached, process-versioned and retains ordered effects, geometry and local settings without photo identity', () => {
	const input = { ...defaultPhotoDevelopV1(), effects: [effect('tone', 'tone-ladder-v1', { exposure: 1 }), effect('wb', 'white-balance-v1', { tint: 20 })],
		geometry: { crop: { x: 0.1, y: 0, width: 0.8, height: 1 }, rotationDegrees: 15, flipHorizontal: true, flipVertical: false },
		masks: [mask('local')], maskBindings: [{ effectId: 'wb', maskId: 'local' }] };
	const packet = copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop: input, selection: all });
	assert.deepEqual(Object.keys(packet).sort(), ['develop', 'kind', 'schemaVersion', 'selection']);
	assert.equal(packet.kind, 'photo-develop-settings'); assert.deepEqual(packet.develop, normalizePhotoDevelopV1(input));
	input.effects.length = 0; input.geometry.rotationDegrees = 90;
	assert.equal(packet.develop.effects.length, 2); assert.equal(packet.develop.geometry.rotationDegrees, 15);
	assert.ok(Object.isFrozen(packet.develop.effects[0]?.params));
	assert.deepEqual(mergePhotoDevelopSettingsV1({ schemaVersion: 1, target: settings(effect('old', 'vignette')), settings: packet }), packet.develop);
});

test('Partial settings replace the selected group in source order and keep all unselected target settings', () => {
	const target = settings(effect('blur', 'gaussian-blur'), effect('old-tone', 'tone-ladder-v1'), effect('vignette', 'vignette'));
	const source = settings(effect('wb', 'white-balance-v1', { temperature: 40 }), effect('new-tone', 'tone-ladder-v1', { exposure: 2 }));
	const packet = copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop: source,
		selection: { ...globals, effectTypes: ['tone-ladder-v1', 'white-balance-v1'] } });
	const result = mergePhotoDevelopSettingsV1({ schemaVersion: 1, target, settings: packet });
	assert.deepEqual(result.effects.map(entry => entry.id), ['blur', 'wb', 'new-tone', 'vignette']);
	assert.deepEqual(result.effects[0], target.effects[0]); assert.deepEqual(result.effects.at(-1), target.effects.at(-1));
	const clearing = copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop: settings(), selection: { ...globals, effectTypes: ['tone-ladder-v1'] } });
	assert.deepEqual(mergePhotoDevelopSettingsV1({ schemaVersion: 1, target, settings: clearing }).effects.map(entry => entry.id), ['blur', 'vignette']);
});

test('Global-only copy leaves masked instances and geometry untouched and resolves source effect ID collisions deterministically', () => {
	const target = normalizePhotoDevelopV1({ ...settings(effect('shared', 'vignette'), effect('masked', 'tone-ladder-v1', { exposure: 3 })),
		geometry: { crop: null, rotationDegrees: 25, flipHorizontal: true, flipVertical: false },
		masks: [mask('local')], maskBindings: [{ effectId: 'masked', maskId: 'local' }] });
	const source = normalizePhotoDevelopV1({ ...settings(effect('shared', 'tone-ladder-v1', { exposure: 1 }), effect('local-source', 'tone-ladder-v1', { exposure: 5 })),
		masks: [mask('local')], maskBindings: [{ effectId: 'local-source', maskId: 'local' }] });
	const packet = copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop: source, selection: { ...globals, effectTypes: ['tone-ladder-v1'] } });
	assert.equal(packet.develop.effects.length, 1); assert.deepEqual(packet.develop.masks, []);
	const result = mergePhotoDevelopSettingsV1({ schemaVersion: 1, target, settings: packet });
	assert.equal(result.effects[0]?.id, 'shared'); assert.equal(result.effects[1]?.id, 'masked');
	assert.notEqual(result.effects[2]?.id, 'shared'); assert.deepEqual(result.effects[1], target.effects[1]);
	assert.deepEqual(result.geometry, target.geometry); assert.deepEqual(result.masks, target.masks); assert.deepEqual(result.maskBindings, target.maskBindings);
	assert.deepEqual(mergePhotoDevelopSettingsV1({ schemaVersion: 1, target, settings: packet }), result);
});

test('Partial local copy remaps colliding masks and effect bindings without donating external media authority', () => {
	const target = normalizePhotoDevelopV1({ ...settings(effect('same', 'vignette')),
		masks: [mask('same-mask', 0.1)], maskBindings: [{ effectId: 'same', maskId: 'same-mask' }] });
	const source = normalizePhotoDevelopV1({ ...settings(effect('same', 'tone-ladder-v1', { exposure: 1 })),
		masks: [mask('same-mask', 0.9)], maskBindings: [{ effectId: 'same', maskId: 'same-mask' }] });
	const packet = copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop: source, selection: { ...all, effectTypes: ['tone-ladder-v1'] } });
	const result = mergePhotoDevelopSettingsV1({ schemaVersion: 1, target, settings: packet });
	assert.equal(result.effects.length, 2); assert.equal(result.masks.length, 2);
	const copied = result.effects[1]!, binding = result.maskBindings.find(entry => entry.effectId === copied.id)!;
	assert.notEqual(copied.id, 'same'); assert.notEqual(binding.maskId, 'same-mask');
	assert.deepEqual(result.masks.find(entry => entry.id === 'same-mask'), target.masks[0]);
	assert.deepEqual(result.masks.find(entry => entry.id === binding.maskId)?.nodes, source.masks[0]?.nodes);
});

test('Repeated local paste retains the same mask inventory and bindings instead of accumulating orphan masks', () => {
	const target = normalizePhotoDevelopV1({ ...settings(effect('same', 'vignette')),
		masks: [mask('same-mask', 0.1)], maskBindings: [{ effectId: 'same', maskId: 'same-mask' }] });
	const source = normalizePhotoDevelopV1({ ...settings(effect('same', 'tone-ladder-v1', { exposure: 1 })),
		masks: [mask('same-mask', 0.9)], maskBindings: [{ effectId: 'same', maskId: 'same-mask' }] });
	const packet = copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop: source, selection: { ...all, effectTypes: ['tone-ladder-v1'] } });
	const first = mergePhotoDevelopSettingsV1({ schemaVersion: 1, target, settings: packet });
	assert.deepEqual(mergePhotoDevelopSettingsV1({ schemaVersion: 1, target: first, settings: packet }), first);
});

test('External mask media cannot cross settings copy or packet admission, even when its source reference looks local', () => {
	const develop = normalizePhotoDevelopV1({ ...settings(effect('tone', 'tone-ladder-v1')),
		masks: [{ schemaVersion: 1, id: 'raster', kind: 'mask', inputs: [{ name: 'image', sourceRef: 'donor-source', kind: 'raster' }],
			nodes: [{ id: 'node', kind: 'raster', inputName: 'image', channel: 'luma' }], outputNodeId: 'node' }],
		maskBindings: [{ effectId: 'tone', maskId: 'raster' }] });
	assert.throws(() => copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop, selection: all }), /authenticated/iu);
	assert.throws(() => normalizePhotoDevelopSettingsPacketV1({ schemaVersion: 1, kind: 'photo-develop-settings', develop, selection: all }), /authenticated/iu);
	assert.deepEqual(copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop, selection: globals }).develop.effects, []);
});

test('Settings admission refuses future schemas, unknown selectors, out-of-selection payloads and accessors without invoking them', () => {
	let getters = 0;
	const hostile = Object.defineProperty({ schemaVersion: 1, selection: all }, 'develop', { enumerable: true, get() { getters++; return settings(); } });
	for (const value of [hostile, { schemaVersion: 2, develop: settings(), selection: all },
		{ schemaVersion: 1, develop: settings(), selection: { ...all, effectTypes: ['future-effect'] } },
		{ schemaVersion: 1, develop: settings(), selection: { ...all, effectTypes: ['vignette', 'vignette'] } },
		{ schemaVersion: 1, develop: { ...settings(), processVersion: 2 }, selection: all }]) {
		assert.throws(() => copyPhotoDevelopSettingsV1(value));
	}
	assert.equal(getters, 0);
	const packet = copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop: settings(), selection: { ...globals, effectTypes: [] } });
	assert.throws(() => normalizePhotoDevelopSettingsPacketV1({ ...packet, develop: settings(effect('hidden', 'vignette')) }), /selection/iu);
	assert.throws(() => normalizePhotoDevelopSettingsPacketV1({ ...packet, authority: 'foreign' }));
});

test('Relative quick Develop adds bounded deltas to the first enabled global instance and preserves other instances and local adjustments', () => {
	const target = normalizePhotoDevelopV1({ ...settings(effect('first', 'tone-ladder-v1', { exposure: 1, highlights: 99 }),
		effect('second', 'tone-ladder-v1', { exposure: 2 }), effect('masked', 'tone-ladder-v1', { exposure: 5 })),
		masks: [mask('local')], maskBindings: [{ effectId: 'masked', maskId: 'local' }] });
	const result = adjustPhotoDevelopSettingsV1({ schemaVersion: 1, target, effectType: 'tone-ladder-v1', changes: { exposure: 0.5, highlights: 5 } });
	assert.equal(result.effects[0]?.params.exposure, 1.5); assert.equal(result.effects[0]?.params.highlights, 100);
	assert.deepEqual(result.effects.slice(1), target.effects.slice(1)); assert.deepEqual(result.maskBindings, target.maskBindings);
	assert.deepEqual(adjustPhotoDevelopSettingsV1({ schemaVersion: 1, target: settings(), effectType: 'tone-ladder-v1', changes: { exposure: 0 } }), settings());
	const added = adjustPhotoDevelopSettingsV1({ schemaVersion: 1, target: settings(), effectType: 'white-balance-v1', changes: { tint: -5 } });
	assert.equal(added.effects[0]?.params.tint, -5); assert.equal(added.effects[0]?.enabled, true);
	assert.throws(() => adjustPhotoDevelopSettingsV1({ schemaVersion: 1, target, effectType: 'tone-ladder-v1', changes: { future: 1 } }));
	assert.throws(() => adjustPhotoDevelopSettingsV1({ schemaVersion: 1, target, effectType: 'tone-ladder-v1', changes: { exposure: Infinity } }));
});

test('Generated stacks retain process version, effect order, deterministic ID remapping and stable copy/paste across serialization', () => {
	for (let index = 0; index < 100; index++) {
		const source = settings(effect('collision', 'tone-ladder-v1', { exposure: (index % 11) - 5 }), effect('wb', 'white-balance-v1', { tint: index - 50 }));
		const target = settings(effect('collision', 'vignette', { amount: index / 100 }), effect('old', 'tone-ladder-v1', { exposure: -1 }));
		const packet = copyPhotoDevelopSettingsV1({ schemaVersion: 1, develop: source, selection: { ...globals, effectTypes: ['tone-ladder-v1'] } });
		const reopened = normalizePhotoDevelopSettingsPacketV1(JSON.parse(JSON.stringify(packet)) as unknown);
		const merged = mergePhotoDevelopSettingsV1({ schemaVersion: 1, target, settings: reopened });
		assert.equal(merged.processVersion, 1); assert.deepEqual(merged.effects[0], target.effects[0]);
		assert.equal(merged.effects[1]?.params.exposure, (index % 11) - 5);
		assert.deepEqual(mergePhotoDevelopSettingsV1({ schemaVersion: 1, target: merged, settings: reopened }), merged);
		assert.deepEqual(mergePhotoDevelopSettingsV1({ schemaVersion: 1, target, settings: packet }), merged);
	}
});
