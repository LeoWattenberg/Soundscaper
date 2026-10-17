/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeVideoVisualPresetV1 } from '../src/common/editor/video-visual-preset-v24.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import type { ImageDevelopSelectionV3, ImageDevelopSettingsPacketV3 } from '../src/common/editor/imaging/image-develop-settings-contract-v3.ts';
import { copyImageDevelopSettingsV3 } from '../src/common/editor/imaging/image-develop-settings-v3.ts';
import { copyImageDevelopSelectedSettingsV3 } from '../src/common/editor/imaging/image-develop-settings-selected-v3.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { copyImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { createImageDevelopPresetV1, serializeImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { createImageDevelopPresetV2, normalizeImageDevelopPresetV2, normalizeImageDevelopPresetV1OrV2,
	serializeImageDevelopPresetV1OrV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import { normalizePhotoDevelopPresetRowV1, photoDevelopPresetsKeyV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';
import { normalizePhotoDevelopPresetRowV1OrV2 } from '../src/lightscaper/storage/photo-develop-preset-row-v2.ts';

import { createImageDevelopPresetV3 as create, normalizeImageDevelopPresetV3 as normalize } from '../src/common/editor/imaging/image-develop-preset-v3.ts';
import { normalizeImageDevelopPresetCurrentV1 as normalizeCurrent, applyImageDevelopPresetCurrentV1 as apply,
	parseImageDevelopPresetCurrentV1 as parse, serializeImageDevelopPresetCurrentV1 as serialize, type ImageDevelopPresetCurrentV1 as PresetCurrent } from '../src/common/editor/imaging/image-develop-preset-current-v1.ts';
import { createImageDevelopSelectedPresetV3 as selectedCreate, normalizeImageDevelopSelectedPresetV3 as selectedNormalize } from '../src/common/editor/imaging/image-develop-preset-selected-v3.ts';
import { normalizePhotoDevelopPresetRowV3 } from '../src/lightscaper/storage/photo-develop-preset-row-v3.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import type { ImageDevelopPresetV3 as Preset3 } from '../src/common/editor/imaging/image-develop-preset-v3.ts';

// Root executed the same assertions against real unchanged strict2 owners.
// These named successor imports bind the captured contract gap after GO.
const row3 = (value: unknown) => normalizePhotoDevelopPresetRowV3(value, 'catalog');
const rowCurrent = (value: unknown) => normalizePhotoDevelopPresetRowCurrentV1(value, 'catalog');
const FULL: ImageDevelopSelectionV3 = { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true };
const LEGACY_FULL = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
const sha = (character: string) => character.repeat(64);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const spot = (id: string, mode: 'clone' | 'heal' = 'clone') => ({ id, mode, enabled: mode === 'clone', target: { x: 0.75, y: 0.5 },
	source: { x: 0.25, y: 0.5 }, radius: 0.15, feather: 0.5, opacity: 0.75 });
function develop(brush = false) {
	const gradient = { schemaVersion: 2, id: 'local', kind: 'matte', name: 'Named local', inputs: [], outputNodeId: 'out',
		nodes: [{ id: 'out', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }] };
	const painted = { schemaVersion: 2, id: 'painted', kind: 'mask', name: 'Retained paint', inputs: [
		{ name: 'paint', sourceRef: `brush-mask-v1:2:1:${sha('a')}`, kind: 'alpha' }, { name: 'unused', sourceRef: `brush-mask-v1:1:1:${sha('b')}`, kind: 'alpha' }],
		nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'alpha' };
	return replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }),
		{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: { storageKey: `lut-sha256:${sha('c')}`, sha256: sha('c'),
			byteLength: 88, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }], masks: brush ? [gradient, painted] : [gradient],
		maskBindings: [{ effectId: 'tone', maskId: 'local' }] }, { schemaVersion: 1, spots: [spot('clone'), spot('heal', 'heal')] });
}
function packet(brush = false, selection: ImageDevelopSelectionV3 = FULL) {
	const value = { schemaVersion: 3, develop: develop(brush), selection };
	return brush ? copyImageDevelopSelectedSettingsV3(value) : copyImageDevelopSettingsV3(value);
}
function literal(settings: ImageDevelopSettingsPacketV3 = packet(), id = 'repair'): Preset3 {
	return { schemaVersion: 3, kind: 'image-develop-preset', settings,
		identity: normalizeVideoVisualPresetV1({ schemaVersion: 1, kind: 'video-preset', id, name: 'Repairs', modelKind: 'adjustment-layer', authoredStateSha256: digest(settings) }) };
}
function oldPreset() { return createImageDevelopPresetV1({ schemaVersion: 1, id: 'old', name: 'Old', settings: copyImageDevelopSettingsV1({ schemaVersion: 1,
	develop: defaultImageDevelopStateV1(), selection: LEGACY_FULL }) }); }
function secondPreset() { return createImageDevelopPresetV2({ schemaVersion: 2, id: 'second', name: 'Second', settings: copyImageDevelopSettingsV2({ schemaVersion: 2,
	develop: defaultImageDevelopStateV2(), selection: LEGACY_FULL }) }); }
const row = (presets: readonly PresetCurrent[] = [literal(), secondPreset(), oldPreset()]) => ({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 7, presets });

test('Preset3 independently hashes exact Packet3 ordered Clone and Heal, local names and disabled LUT metadata', () => {
	const settings = packet(), preset = create({ schemaVersion: 3, id: 'repair', name: 'Repairs', settings });
	assert.equal(preset.schemaVersion, 3); assert.deepEqual(preset.settings, settings); assert.equal(preset.identity.authoredStateSha256, digest(settings));
	assert.deepEqual(normalize(structuredClone(preset)), preset); assert.ok(Object.isFrozen(preset)); assert.ok(Object.isFrozen(preset.settings.develop));
	const reversed = { ...settings, develop: { ...develop(), repairs: { schemaVersion: 1, spots: [...develop().repairs.spots].reverse() } } };
	assert.throws(() => normalize({ ...preset, settings: reversed }), /digest|identity/iu);
	assert.deepEqual(preset.settings.develop.masks, develop().masks); assert.deepEqual(preset.settings.develop.effects, develop().effects);
});

test('partial repair presets replace the ordered group and an explicit empty repair preset promotes sticky3', () => {
	const selection = { effectTypes: [] as readonly string[], geometry: false, localAdjustments: false, repairs: true };
	const preset = create({ schemaVersion: 3, id: 'partial', name: 'Repairs only', settings: packet(false, selection) });
	const target = replaceImageDevelopRepairSpotsV1(develop(), { schemaVersion: 1, spots: [spot('target')] });
	const result = apply({ schemaVersion: 3, target, preset }); assert.equal(result.processVersion, 3);
	if (result.processVersion !== 3) assert.fail('Expected process3.'); assert.deepEqual(result.repairs, develop().repairs); assert.deepEqual(result.effects, target.effects); assert.deepEqual(result.masks, target.masks);
	const empty = copyImageDevelopSettingsV3({ schemaVersion: 3, develop: replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV1(), { schemaVersion: 1, spots: [] }), selection });
	const clearing = create({ schemaVersion: 3, id: 'clear', name: 'Clear repairs', settings: empty });
	for (const target of [defaultImageDevelopStateV1(), defaultImageDevelopStateV2(), develop()]) {
		const result = apply({ schemaVersion: 3, target, preset: clearing }); assert.equal(result.processVersion, 3);
		if (result.processVersion !== 3) assert.fail('Expected sticky3.'); assert.deepEqual(result.repairs.spots, []);
	}
});

test('legacy presets applied through Current retain exact target repairs and unselected native resource declarations', () => {
	const target = develop(true), legacy = createImageDevelopPresetV2({ schemaVersion: 2, id: 'global', name: 'Global', settings: copyImageDevelopSettingsV2({ schemaVersion: 2,
		develop: defaultImageDevelopStateV2(), selection: { effectTypes: [], geometry: false, localAdjustments: false } }) });
	const result = apply({ schemaVersion: 3, target, preset: legacy }); assert.deepEqual(result, target);
	assert.equal(result.processVersion, 3); if (result.processVersion !== 3) assert.fail('Expected process3.'); assert.deepEqual(result.repairs, target.repairs);
});

test('selected Preset3 metadata retains every used and unused brush declaration without a body proof', () => {
	const settings = packet(true), preset = selectedCreate({ schemaVersion: 3, id: 'brush', name: 'Paint and repairs', settings });
	assert.deepEqual(preset.settings, settings); assert.equal(preset.identity.authoredStateSha256, digest(settings));
	assert.deepEqual(selectedNormalize(structuredClone(preset)), preset); assert.deepEqual(Object.keys(preset).sort(), ['identity', 'kind', 'schemaVersion', 'settings']);
	const altered = { ...settings, develop: { ...develop(true), masks: develop(true).masks.map(mask => mask.id === 'painted'
		? { ...mask, inputs: mask.inputs.map(input => input.name === 'unused' ? { ...input, sourceRef: `brush-mask-v1:1:1:${sha('d')}` } : input) } : mask) } };
	assert.throws(() => selectedNormalize({ ...preset, settings: altered }), /digest|identity/iu);
	assert.throws(() => create({ schemaVersion: 3, id: 'brush', name: 'Paint', settings }), /external|authenticated|brush/iu);
	assert.throws(() => parse(JSON.stringify(preset)), /external|authenticated|brush/iu);
});

test('renaming only scalar preset identity preserves complete settings and exact authored digest', () => {
	const preset = literal(packet(true)); const renamed = selectedNormalize({ ...preset, identity: { ...preset.identity, name: 'Renamed preset' } });
	assert.equal(renamed.identity.id, preset.identity.id); assert.equal(renamed.identity.authoredStateSha256, preset.identity.authoredStateSha256);
	assert.deepEqual(renamed.settings, preset.settings); assert.equal(renamed.identity.name, 'Renamed preset');
});

test('Current JSON dispatch retains explicit3 and exact legacy1/2 bytes without load-time promotion', () => {
	const preset = literal(), text = serialize(preset); assert.deepEqual(parse(text), preset); assert.equal(serialize(parse(text)), text);
	for (const old of [oldPreset(), secondPreset()]) { const expected = serializeImageDevelopPresetV1OrV2(old);
		assert.equal(serialize(normalizeCurrent(structuredClone(old))), expected); assert.equal(serialize(parse(expected)), expected); }
	assert.equal(oldPreset().identity.authoredStateSha256, 'b272353c51e445ebda2dd44a9222ab26095026544b022d047cbcc3281d14484d');
	assert.throws(() => normalizeImageDevelopPresetV1OrV2(preset)); assert.throws(() => normalizeImageDevelopPresetV2(preset));
});

test('Preset3 closed admission refuses accessors, hidden authority, future versions and incorrect hash before hooks run', () => {
	const preset = literal(); let reads = 0;
	assert.throws(() => normalize({ ...preset, schemaVersion: 4 }));
	const accessor = Object.defineProperty({ ...preset }, 'settings', { enumerable: true, get() { reads++; return preset.settings; } });
	for (const value of [accessor, { ...preset, body: new Uint8Array(1) }, { ...preset, catalogId: 'foreign' }, { ...preset, [Symbol('authority')]: true },
		Object.assign(Object.create({ inherited: true }) as object, preset), { ...preset, schemaVersion: 5 },
		{ ...preset, identity: { ...preset.identity, authoredStateSha256: sha('0') } }, { ...preset, identity: { ...preset.identity, modelKind: 'generator' } }]) assert.throws(() => normalizeCurrent(value));
	assert.equal(reads, 0);
	const bad = { ...preset.settings, develop: { ...develop(), repairs: { schemaVersion: 1 as const, spots: [{ ...spot('bad'), opacity: 2 }] } } };
	assert.throws(() => normalizeCurrent(literal(bad)));
	const invalidSelection = { ...preset.settings, selection: { ...FULL, repairs: undefined } };
	assert.throws(() => normalizeCurrent({ ...preset, settings: invalidSelection, identity: { ...preset.identity, authoredStateSha256: digest(invalidSelection) } }));
});

test('the full64 repair list is hashed while a65th inactive declaration cannot be hidden in a preset', () => {
	const spots = Array.from({ length: 64 }, (_, index) => ({ ...spot(`spot-${String(index)}`, index % 2 ? 'heal' : 'clone'), enabled: false }));
	const state = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots });
	const settings = copyImageDevelopSettingsV3({ schemaVersion: 3, develop: state, selection: FULL }), preset = create({ schemaVersion: 3, id: '64', name: 'All declarations', settings });
	assert.equal(preset.settings.develop.processVersion, 3); if (preset.settings.develop.processVersion !== 3) assert.fail('Expected process3.');
	assert.deepEqual(preset.settings.develop.repairs.spots, spots); assert.equal(preset.identity.authoredStateSha256, digest(settings));
	const bad = { ...settings, develop: { ...state, repairs: { schemaVersion: 1 as const, spots: [...spots, { ...spot('extra'), enabled: false }] } } };
	assert.throws(() => normalizeCurrent(literal(bad))); assert.equal(state.repairs.spots.length, 64);
});

test('Preset3 external JSON enforces the existing2MiB UTF8 bound before parsing', () => {
	const preset = literal(), text = JSON.stringify(preset), padded = text + ' '.repeat(2_097_152 - new TextEncoder().encode(text).byteLength);
	assert.deepEqual(parse(padded), preset); assert.throws(() => parse(`${padded} `), /byte budget/iu);
	assert.throws(() => parse(`"${'é'.repeat(1_048_576)}"`), /byte budget/iu); assert.throws(() => parse('{'), SyntaxError);
});

test('mixed Row3 admits current and legacy presets at the existing physical key with canonical ID ordering', () => {
	const input = row(), admitted = row3(input); assert.equal(admitted.schemaVersion, 3); assert.equal(admitted.revision, 7);
	assert.deepEqual(admitted.presets.map(preset => preset.identity.id), ['old', 'repair', 'second']);
	assert.deepEqual(admitted.presets.map(preset => preset.schemaVersion), [1, 3, 2]); assert.deepEqual(rowCurrent(structuredClone(admitted)), admitted);
	assert.equal(photoDevelopPresetsKeyV1('catalog'), 'photo-library:develop-presets:v1:catalog');
	const selected = row3(row([literal(packet(true))])); assert.deepEqual(selected.presets[0]!.settings.develop.masks, develop(true).masks);
	assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.presets)); Reflect.set(input.presets, 'length', 0); assert.equal(admitted.presets.length, 3);
});

test('empty Row3 stays explicit3 while actual legacy rows stay byte-identical and old readers refuse3', () => {
	const empty = rowCurrent(row([])); assert.equal(empty.schemaVersion, 3); assert.equal(empty.revision, 7); assert.deepEqual(empty.presets, []);
	for (const old of [{ ...row([oldPreset()]), schemaVersion: 1 }, { ...row([oldPreset(), secondPreset()]), schemaVersion: 2 }]) {
		const admitted = normalizePhotoDevelopPresetRowV1OrV2(old, 'catalog'); assert.equal(JSON.stringify(rowCurrent(structuredClone(old))), JSON.stringify(admitted)); }
	assert.throws(() => normalizePhotoDevelopPresetRowV1(row(), 'catalog')); assert.throws(() => normalizePhotoDevelopPresetRowV1OrV2(row(), 'catalog'));
});

test('Row3 owning admission detaches the complete row and rejects foreign or future envelopes, duplicate IDs and17 presets', () => {
	let reads = 0; const input = row(), accessor = Object.defineProperty(row(), 'presets', { enumerable: true, get() { reads++; return []; } });
	assert.throws(() => row3({ ...input, schemaVersion: 4 }));
	for (const value of [accessor, { ...input, catalogId: 'foreign' }, { ...input, revision: 0 }, { ...input, revision: Number.MAX_SAFE_INTEGER + 1 },
		{ ...input, schemaVersion: 5 }, { ...input, body: new Blob() }, row([literal(), literal()]), row(Array.from({ length: 17 }, (_, index) => literal(packet(), `preset-${String(index)}`)))]) assert.throws(() => rowCurrent(value));
	assert.equal(reads, 0); assert.deepEqual(input, row());
});

test('individually bounded Preset3 records cannot overflow the unchanged10MiB combined native row capacity', () => {
	const point = { position: { x: 0.1234567890123456, y: 0.1234567890123456 }, inHandle: null, outHandle: null };
	const state = replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV2(), masks: [{ schemaVersion: 1, id: 'path', kind: 'mask', inputs: [], outputNodeId: 'node',
		nodes: [{ id: 'node', kind: 'vector-path', fillRule: 'nonzero', paths: [{ id: 'outline', closed: true, points: Array.from({ length: 16_384 }, () => point) }] }] }] }, { schemaVersion: 1, spots: [] });
	const settings = copyImageDevelopSettingsV3({ schemaVersion: 3, develop: state, selection: FULL });
	const presets = Array.from({ length: 8 }, (_, index) => literal(settings, `large-${String(index)}`));
	assert.ok(new TextEncoder().encode(JSON.stringify(presets[0])).byteLength < 2_097_152); assert.ok(new TextEncoder().encode(JSON.stringify(presets)).byteLength > 10_485_760);
	assert.throws(() => row3(row(presets)), /UTF8 byte bound/iu);
});

test('permanent strict legacy preset and row frontdoors remain available without Current promotion', () => {
	const first = oldPreset(), second = secondPreset(); assert.equal(serializeImageDevelopPresetV1OrV2(first), serializeImageDevelopPresetV1(first));
	assert.deepEqual(normalizeImageDevelopPresetV1OrV2(second), second);
	const old = { ...row([first, second]), schemaVersion: 2 }; assert.equal(normalizePhotoDevelopPresetRowV1OrV2(old, 'catalog').schemaVersion, 2);
	assert.throws(() => createImageDevelopPresetV2({ schemaVersion: 2, id: 'repair', name: 'Unsupported', settings: packet() }));
});
