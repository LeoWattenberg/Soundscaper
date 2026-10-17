/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import fc from 'fast-check';
import { createImageDevelopPresetV1, normalizeImageDevelopPresetV1, applyImageDevelopPresetV1,
	parseImageDevelopPresetV1, serializeImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1, normalizeImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import type { ImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-contract-v1.ts';
import { normalizeVideoVisualPresetV1 } from '../src/common/editor/video-visual-preset-v24.ts';
import { normalizeVideoEffects, createVideoEffect } from '../src/common/editor/video-effects.js';
import type { VideoEffectLeaf } from '../src/common/editor/project-media-types.ts';

const effect = (id: string, type: string, params: Record<string, number> = {}): VideoEffectLeaf =>
	createVideoEffect(type, { id, params }) as VideoEffectLeaf;
const state = (...effects: VideoEffectLeaf[]): ImageDevelopStateV1 => normalizeImageDevelopStateV1({ ...defaultImageDevelopStateV1(), effects });
const all = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
const partial = { effectTypes: ['tone-ladder-v1'], geometry: false, localAdjustments: false };
const settings = (develop: ImageDevelopStateV1, selection = all) => copyImageDevelopSettingsV1({ schemaVersion: 1, develop, selection });
const create = (develop = state(), selection: typeof all | typeof partial = all) => createImageDevelopPresetV1({
	schemaVersion: 1, id: 'preset-1', name: 'Evening', settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop, selection }) });

test('A full preset carries detached settings and the existing shared digest-bound visual identity', () => {
	const source = normalizeImageDevelopStateV1({ ...state(effect('tone', 'tone-ladder-v1', { exposure: 1 })),
		geometry: { crop: null, rotationDegrees: 15, flipHorizontal: true, flipVertical: false } });
	const packet = settings(source), preset = createImageDevelopPresetV1({ schemaVersion: 1, id: 'preset-1', name: 'Evening', settings: packet });
	assert.equal(preset.kind, 'image-develop-preset'); assert.equal(preset.identity.modelKind, 'adjustment-layer');
	assert.deepEqual(normalizeVideoVisualPresetV1(preset.identity), preset.identity);
	assert.equal(preset.identity.authoredStateSha256, createHash('sha256').update(JSON.stringify(packet)).digest('hex'));
	assert.notEqual(preset.settings, packet); assert.notEqual(preset.settings.develop, source);
	assert.ok(Object.isFrozen(preset.settings.develop.effects[0]?.params));
	assert.deepEqual(applyImageDevelopPresetV1({ schemaVersion: 1, target: state(effect('old', 'vignette')), preset }), source);
});

test('Partial preset application replaces the selected group and keeps unselected settings and target geometry', () => {
	const target = normalizeImageDevelopStateV1({ ...state(effect('blur', 'gaussian-blur'), effect('old', 'tone-ladder-v1'), effect('vignette', 'vignette')),
		geometry: { crop: null, rotationDegrees: 25, flipHorizontal: false, flipVertical: true } });
	const preset = create(state(effect('new', 'tone-ladder-v1', { exposure: 2 }), effect('omitted', 'white-balance-v1')), partial);
	assert.deepEqual(preset.settings.develop.effects.map(item => item.id), ['new']);
	const result = applyImageDevelopPresetV1({ schemaVersion: 1, target, preset });
	assert.deepEqual(result.effects.map(item => item.id), ['blur', 'new', 'vignette']);
	assert.deepEqual(result.geometry, target.geometry); assert.deepEqual(result.effects[0], target.effects[0]);
	assert.deepEqual(applyImageDevelopPresetV1({ schemaVersion: 1, target: result, preset }), result);
	assert.deepEqual(applyImageDevelopPresetV1({ schemaVersion: 1, target, preset: create(state(), partial) }).effects.map(item => item.id), ['blur', 'vignette']);
});

test('Preset bodies round-trip canonically and use the same shared effects accepted by Frame authoring', () => {
	const preset = create(state(effect('wb', 'white-balance-v1', { temperature: 20 }), effect('tone', 'tone-ladder-v1', { shadows: 40 })));
	const encoded = serializeImageDevelopPresetV1(preset), reopened = parseImageDevelopPresetV1(encoded);
	assert.deepEqual(reopened, preset); assert.equal(serializeImageDevelopPresetV1(reopened), encoded);
	const applied = applyImageDevelopPresetV1({ schemaVersion: 1, target: state(), preset: reopened });
	assert.deepEqual(normalizeVideoEffects(applied.effects, 'Frame preset stack'), applied.effects);
	assert.equal(applied.processVersion, 1);
});

test('The process-1 neutral full preset has a stable identity digest from the pre-extraction packet golden', () => {
	assert.equal(create().identity.authoredStateSha256, 'b272353c51e445ebda2dd44a9222ab26095026544b022d047cbcc3281d14484d');
});

test('Local preset recipes retain coherent remapped masks across repeated partial application', () => {
	const mask = (x: number) => ({ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [], outputNodeId: 'shape',
		nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'ellipse', x, y: 0, width: 0.5, height: 1 }] });
	const target = normalizeImageDevelopStateV1({ ...state(effect('same', 'vignette')), masks: [mask(0)], maskBindings: [{ effectId: 'same', maskId: 'mask' }] });
	const donor = normalizeImageDevelopStateV1({ ...state(effect('same', 'tone-ladder-v1')), masks: [mask(0.5)], maskBindings: [{ effectId: 'same', maskId: 'mask' }] });
	const preset = create(donor, { ...partial, localAdjustments: true });
	const result = applyImageDevelopPresetV1({ schemaVersion: 1, target, preset });
	assert.equal(result.effects.length, 2); assert.equal(result.masks.length, 2);
	assert.deepEqual(result.effects[0], target.effects[0]); assert.deepEqual(result.masks.find(item => item.id === 'mask'), target.masks[0]);
	const donated = result.maskBindings.find(item => item.effectId === result.effects[1]?.id)!;
	assert.notEqual(donated.maskId, 'mask'); assert.deepEqual(result.masks.find(item => item.id === donated.maskId)?.nodes, donor.masks[0]?.nodes);
	assert.deepEqual(applyImageDevelopPresetV1({ schemaVersion: 1, target: result, preset: parseImageDevelopPresetV1(serializeImageDevelopPresetV1(preset)) }), result);
});

test('An identity cannot authenticate external raster media or hidden out-of-selection preset settings', () => {
	const preset = create();
	const external = normalizeImageDevelopStateV1({ ...state(effect('tone', 'tone-ladder-v1')),
		masks: [{ schemaVersion: 1, id: 'raster', kind: 'mask', inputs: [{ name: 'image', sourceRef: 'foreign-original', kind: 'raster' }],
			nodes: [{ id: 'node', kind: 'raster', inputName: 'image', channel: 'luma' }], outputNodeId: 'node' }], maskBindings: [{ effectId: 'tone', maskId: 'raster' }] });
	const packet = { ...preset.settings, develop: external };
	assert.throws(() => createImageDevelopPresetV1({ schemaVersion: 1, id: 'external', name: 'External', settings: packet }), /authenticated/iu);
	assert.throws(() => normalizeImageDevelopPresetV1({ ...preset, settings: { ...preset.settings,
		selection: { ...partial, effectTypes: [] }, develop: state(effect('hidden', 'tone-ladder-v1')) } }), /selection/iu);
});

test('The identity binds selectors and settings while explicit process versions survive reopening', () => {
	const preset = create(state(effect('tone', 'tone-ladder-v1', { exposure: 1 })), partial);
	const changed = settings(state(effect('tone', 'tone-ladder-v1', { exposure: 2 })), all);
	assert.throws(() => normalizeImageDevelopPresetV1({ ...preset, settings: changed }), /digest/iu);
	assert.throws(() => normalizeImageDevelopPresetV1({ ...preset, settings: { ...preset.settings, selection: all } }), /digest/iu);
	assert.throws(() => normalizeImageDevelopPresetV1({ ...preset, identity: { ...preset.identity, modelKind: 'generator' } }), /adjustment-layer/iu);
	assert.throws(() => normalizeImageDevelopPresetV1({ ...preset, settings: { ...preset.settings,
		develop: { ...preset.settings.develop, processVersion: 2 } } }), /process/iu);
	assert.equal(parseImageDevelopPresetV1(serializeImageDevelopPresetV1(preset)).settings.develop.processVersion, 1);
});

test('Closed preset admission refuses extra authority, nested accessors and future versions before reading them', () => {
	const preset = create(); let invoked = 0;
	const hostile = Object.defineProperty({ ...preset }, 'settings', { enumerable: true, get() { invoked++; return preset.settings; } });
	for (const value of [hostile, { ...preset, schemaVersion: 2 }, { ...preset, kind: 'future-preset' },
		{ ...preset, catalogId: 'foreign' }, { ...preset, original: { storageKey: 'donor' } },
		{ ...preset, identity: { ...preset.identity, executable: 'script' } }, { ...preset, settings: { ...preset.settings, authority: 'media' } }]) {
		assert.throws(() => normalizeImageDevelopPresetV1(value));
	}
	assert.equal(invoked, 0);
	assert.throws(() => createImageDevelopPresetV1({ schemaVersion: 2, id: 'p', name: 'P', settings: preset.settings }));
	assert.throws(() => applyImageDevelopPresetV1({ schemaVersion: 2, target: state(), preset }));
});

test('Preset parsing refuses scalar byte overflow before JSON interpretation and never coerces input', () => {
	assert.throws(() => parseImageDevelopPresetV1('é'.repeat(1_048_577)), /byte budget/iu);
	assert.throws(() => parseImageDevelopPresetV1(' '.repeat(2_097_153)), /byte budget/iu);
	assert.throws(() => parseImageDevelopPresetV1('{'), SyntaxError);
	let coerced = 0;
	assert.throws(() => parseImageDevelopPresetV1({ toString() { coerced++; return serializeImageDevelopPresetV1(create()); } }));
	assert.equal(coerced, 0);
});

test('Generated full and partial presets retain process, unselected order and repeatable application across serialization', () => {
	const generator = fc.array(fc.record({ type: fc.constantFrom('tone-ladder-v1', 'white-balance-v1', 'vignette'),
		enabled: fc.boolean(), value: fc.integer({ min: -5, max: 5 }) }), { maxLength: 24 });
	fc.assert(fc.property(generator, generator, fc.boolean(), (donors, targets, full) => {
		const build = (items: typeof donors) => state(...items.map((item, index) => ({
			...effect(`effect-${String(index)}`, item.type, item.type === 'tone-ladder-v1' ? { exposure: item.value }
				: item.type === 'white-balance-v1' ? { tint: item.value * 20 } : { amount: (item.value + 5) / 10 }), enabled: item.enabled })));
		const target = build(targets), donor = build(donors), preset = create(donor, full ? all : partial);
		const reopened = parseImageDevelopPresetV1(serializeImageDevelopPresetV1(preset));
		const result = applyImageDevelopPresetV1({ schemaVersion: 1, target, preset: reopened });
		assert.equal(result.processVersion, 1);
		if (full) assert.deepEqual(result, donor);
		else assert.deepEqual(result.effects.filter(item => item.type !== 'tone-ladder-v1'), target.effects.filter(item => item.type !== 'tone-ladder-v1'));
		assert.deepEqual(applyImageDevelopPresetV1({ schemaVersion: 1, target: result, preset: reopened }), result);
		assert.equal(serializeImageDevelopPresetV1(reopened), serializeImageDevelopPresetV1(preset));
	}), { seed: 718_431, numRuns: 128 });
});
