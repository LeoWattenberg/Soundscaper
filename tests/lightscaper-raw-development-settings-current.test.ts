/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV4 } from '../src/common/editor/imaging/image-develop-state-v4.ts';
import { normalizeImageDevelopSettingsPacketCurrentV1 } from '../src/common/editor/imaging/image-develop-settings-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { copyImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { copyImageDevelopSettingsV3, normalizeImageDevelopSettingsPacketV3 } from '../src/common/editor/imaging/image-develop-settings-v3.ts';
import { copyImageDevelopSettingsV4, mergeImageDevelopSettingsV4, adjustImageDevelopSettingsV4 } from '../src/common/editor/imaging/image-develop-settings-v4.ts';
import { copyImageDevelopSelectedSettingsV4, normalizeImageDevelopSelectedSettingsPacketV4,
	mergeImageDevelopSelectedSettingsV4 } from '../src/common/editor/imaging/image-develop-settings-selected-v4.ts';
import type { ImageDevelopSelectionV4 } from '../src/common/editor/imaging/image-develop-settings-contract-v4.ts';
import { createImageDevelopPresetV3, normalizeImageDevelopPresetV3 } from '../src/common/editor/imaging/image-develop-preset-v3.ts';
import { createImageDevelopPresetV4, serializeImageDevelopPresetV4, parseImageDevelopPresetV4 } from '../src/common/editor/imaging/image-develop-preset-v4.ts';
import { createImageDevelopSelectedPresetV4 } from '../src/common/editor/imaging/image-develop-preset-selected-v4.ts';
import { normalizeImageDevelopPresetCurrentV1, applyImageDevelopPresetCurrentV1 } from '../src/common/editor/imaging/image-develop-preset-current-v1.ts';
import { normalizePhotoDevelopPresetRowV3 } from '../src/lightscaper/storage/photo-develop-preset-row-v3.ts';
import { normalizePhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import { encodePhotoDevelopPresetPackV3, readPhotoDevelopPresetPackV3 } from '../src/lightscaper/archive/develop-preset-pack-v3.ts';
import { encodePhotoDevelopPresetPackCurrentV1, readPhotoDevelopPresetPackCurrentV1 } from '../src/lightscaper/archive/develop-preset-pack-current-v1.ts';

const FULL: ImageDevelopSelectionV4 = { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true, rawDevelopment: true };
const RAW_ONLY: ImageDevelopSelectionV4 = { effectTypes: [], geometry: false, localAdjustments: false, repairs: false, rawDevelopment: true };
const SHA = 'a'.repeat(64), BRUSH = `brush-mask-v1:2:1:${'b'.repeat(64)}`, CATALOG = 'raw-settings-catalog';
function recipe(mode: 'canonical' | 'headroom' | 'recovery' = 'recovery', resources = false) {
	return normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV1(), processVersion: 4,
		effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }),
			...(resources ? [{ id: 'retained-lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: {
				storageKey: `lut-sha256:${SHA}`, sha256: SHA, byteLength: 83, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }] : [])],
		geometry: { crop: null, rotationDegrees: 90, flipHorizontal: true, flipVertical: false },
		masks: [{ schemaVersion: 2, id: 'named', name: 'Retained adjustment', kind: 'matte',
			inputs: resources ? [{ name: 'Paint', kind: 'alpha', sourceRef: BRUSH }, { name: 'Unused', kind: 'alpha', sourceRef: BRUSH }] : [],
			nodes: resources ? [{ id: 'coverage', kind: 'alpha', inputName: 'Paint' }]
				: [{ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'coverage' }],
		maskBindings: [{ effectId: 'tone', maskId: 'named' }], repairs: { schemaVersion: 1, spots: [
			{ id: 'repair', mode: 'clone', enabled: true, target: { x: .75, y: .5 }, source: { x: .25, y: .5 }, radius: .1, feather: 0, opacity: 1 }] },
		rawDevelopment: { schemaVersion: 1, mode } });
}
function through3(value = recipe()) {
	return normalizeImageDevelopStateV3({ processVersion: 3, effects: value.effects, geometry: value.geometry, masks: value.masks,
		maskBindings: value.maskBindings, repairs: value.repairs });
}
async function* chunks(bytes: Uint8Array, size = 7) { for (let start = 0; start < bytes.length; start += size) yield bytes.slice(start, start + size); }
async function collect(stream: AsyncIterable<Uint8Array>) { const parts: Uint8Array[] = []; for await (const part of stream) parts.push(part); return new Uint8Array(Buffer.concat(parts)); }

test('Current settings retain the independently selected recovery source in an explicit packet4', () => {
	const develop = normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV1(), processVersion: 4,
		repairs: { schemaVersion: 1, spots: [] }, rawDevelopment: { schemaVersion: 1, mode: 'recovery' } });
	const packet = { schemaVersion: 4, kind: 'photo-develop-settings', develop,
		selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true, rawDevelopment: true } };
	assert.deepEqual(normalizeImageDevelopSettingsPacketCurrentV1(packet), packet);
});

test('RAW-only donation changes source processing independently of repairs, geometry, local effects and retained resources', () => {
	const donor = recipe(), target = recipe('headroom', true), before = JSON.stringify(target);
	const packet = copyImageDevelopSettingsV4({ schemaVersion: 4, develop: donor, selection: RAW_ONLY });
	assert.equal(packet.develop.processVersion, 4); assert.deepEqual(packet.develop.effects, []); assert.deepEqual(packet.develop.masks, []);
	const result = mergeImageDevelopSelectedSettingsV4({ schemaVersion: 4, target, settings: packet });
	assert.deepEqual(result, { ...target, rawDevelopment: donor.rawDevelopment }); assert.equal(JSON.stringify(target), before);
	const unselected = copyImageDevelopSettingsV4({ schemaVersion: 4, develop: donor, selection: { ...FULL, rawDevelopment: false } });
	assert.equal(unselected.develop.processVersion, 4);
	if (unselected.develop.processVersion !== 4) assert.fail('Expected copied process4.');
	assert.equal(unselected.develop.rawDevelopment.mode, 'canonical');
	const pasted = mergeImageDevelopSettingsV4({ schemaVersion: 4, target: recipe('headroom'), settings: unselected });
	assert.deepEqual(pasted, { ...donor, rawDevelopment: target.rawDevelopment });
});

test('old packets retain the target RAW mode and new packets can explicitly clear it without downgrading process4', () => {
	const target = recipe('headroom'), old = through3();
	const packets = [copyImageDevelopSettingsV2({ schemaVersion: 2, develop: defaultImageDevelopStateV1(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true } }),
		copyImageDevelopSettingsV3({ schemaVersion: 3, develop: old, selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true } })];
	for (const settings of packets) {
		const result = mergeImageDevelopSettingsV4({ schemaVersion: 4, target, settings });
		assert.equal(result.processVersion, 4); if (result.processVersion !== 4) assert.fail('Expected sticky4.');
		assert.deepEqual(result.rawDevelopment, target.rawDevelopment);
	}
	const packet = copyImageDevelopSettingsV4({ schemaVersion: 4, develop: defaultImageDevelopStateV1(), selection: RAW_ONLY });
	const cleared = mergeImageDevelopSettingsV4({ schemaVersion: 4, target, settings: packet });
	assert.deepEqual(cleared, { ...target, rawDevelopment: { schemaVersion: 1, mode: 'canonical' } });
});

test('selected packet4 preserves complete inert declarations while external metadata remains resource strict', () => {
	const source = recipe('recovery', true), packet = copyImageDevelopSelectedSettingsV4({ schemaVersion: 4, develop: source, selection: FULL });
	assert.deepEqual(packet.develop, source); assert.deepEqual(normalizeImageDevelopSelectedSettingsPacketV4(packet), packet);
	assert.deepEqual(mergeImageDevelopSelectedSettingsV4({ schemaVersion: 4, target: recipe('headroom'), settings: packet }), source);
	assert.throws(() => copyImageDevelopSettingsV4({ schemaVersion: 4, develop: source, selection: FULL }), /external|authenticated/iu);
	assert.throws(() => normalizeImageDevelopSettingsPacketCurrentV1(packet), /external|authenticated/iu);
	const withoutRaw = copyImageDevelopSelectedSettingsV4({ schemaVersion: 4, develop: source, selection: { ...FULL, rawDevelopment: false, repairs: false } });
	assert.deepEqual(withoutRaw.develop.masks, source.masks); assert.deepEqual(withoutRaw.develop.effects, source.effects);
});

test('packet4 requires an independent own RAW boolean and fixed packet3 refuses the future process and fields', () => {
	let invoked = 0; const source = recipe(), packet = copyImageDevelopSettingsV4({ schemaVersion: 4, develop: source, selection: FULL });
	for (const selection of [{ effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true }, { ...FULL, rawDevelopment: 1 },
		{ ...FULL, extra: true }, Object.defineProperty({ ...FULL }, 'rawDevelopment', { enumerable: true, get() { invoked++; return true; } })]) {
		assert.throws(() => copyImageDevelopSettingsV4({ schemaVersion: 4, develop: source, selection }));
	}
	assert.throws(() => normalizeImageDevelopSettingsPacketV3(packet));
	assert.throws(() => normalizeImageDevelopSettingsPacketV3({ ...packet, schemaVersion: 3 }));
	assert.throws(() => copyImageDevelopSettingsV3({ schemaVersion: 3, develop: source, selection: FULL }));
	assert.equal(invoked, 0);
});

test('quick adjustments retain process4 source metadata and resources including exact zero-change serialization', () => {
	const target = recipe('headroom', true), wire = JSON.stringify(target);
	const noOp = adjustImageDevelopSettingsV4({ schemaVersion: 4, target, effectType: 'tone-ladder-v1', changes: { exposure: 0 } });
	assert.equal(JSON.stringify(noOp), wire);
	const result = adjustImageDevelopSettingsV4({ schemaVersion: 4, target, effectType: 'tone-ladder-v1', changes: { exposure: .25 } });
	assert.equal(result.processVersion, 4); if (result.processVersion !== 4) assert.fail('Expected process4.');
	assert.deepEqual(result.rawDevelopment, target.rawDevelopment); assert.deepEqual(result.repairs, target.repairs);
	assert.deepEqual(result.masks, target.masks); assert.deepEqual(result.maskBindings, target.maskBindings);
	assert.deepEqual(result.effects.find(effect => effect.id === 'tone'), target.effects[0]); assert.equal(JSON.stringify(target), wire);
});

test('external preset4 JSON binds the RAW setting to its identity and Current application preserves old request3 callers', () => {
	const settings = copyImageDevelopSettingsV4({ schemaVersion: 4, develop: recipe(), selection: FULL });
	const preset = createImageDevelopPresetV4({ schemaVersion: 4, id: 'recovery', name: 'Recover sensor highlights', settings });
	const text = serializeImageDevelopPresetV4(preset); assert.equal(serializeImageDevelopPresetV4(parseImageDevelopPresetV4(text)), text);
	assert.deepEqual(normalizeImageDevelopPresetCurrentV1(preset), preset); assert.throws(() => normalizeImageDevelopPresetV3(preset));
	assert.deepEqual(applyImageDevelopPresetCurrentV1({ schemaVersion: 3, target: recipe('headroom'), preset }), recipe());
	assert.throws(() => parseImageDevelopPresetV4(JSON.stringify({ ...preset, settings: { ...settings,
		develop: { ...recipe(), rawDevelopment: { schemaVersion: 1, mode: 'headroom' } } } })), /digest|identity/iu);
	const oldSettings = copyImageDevelopSettingsV3({ schemaVersion: 3, develop: through3(), selection: { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true } });
	const old = createImageDevelopPresetV3({ schemaVersion: 3, id: 'old', name: 'Old recipe', settings: oldSettings });
	assert.equal(JSON.stringify(normalizeImageDevelopPresetCurrentV1(old)), JSON.stringify(old));
});

test('Current row4 and streaming pack retain complete selected recipes without widening fixed row3 or pack3', async () => {
	const source = recipe('recovery', true), settings = copyImageDevelopSelectedSettingsV4({ schemaVersion: 4, develop: source, selection: FULL });
	const preset = createImageDevelopSelectedPresetV4({ schemaVersion: 4, id: 'retained', name: 'Painted recovery', settings });
	const row = normalizePhotoDevelopPresetRowCurrentV1({ schemaVersion: 4, kind: 'photo-develop-presets', catalogId: CATALOG, revision: 2, presets: [preset] }, CATALOG);
	assert.equal(row.schemaVersion, 4); assert.deepEqual(row.presets[0], preset); assert.throws(() => normalizePhotoDevelopPresetRowV3(row, CATALOG));
	assert.throws(() => encodePhotoDevelopPresetPackV3(row, CATALOG));
	const mutable = structuredClone(row), stream = encodePhotoDevelopPresetPackCurrentV1(mutable, CATALOG);
	const captured = mutable.presets[0]!; if (captured.settings.develop.processVersion !== 4) assert.fail('Expected process4.');
	// Keep caller edits distinct from the synchronously captured pack metadata.
	Reflect.set(captured.settings.develop.rawDevelopment, 'mode', 'headroom');
	const bytes = await collect(stream); assert.deepEqual(await readPhotoDevelopPresetPackCurrentV1(chunks(bytes), CATALOG), row);
	await assert.rejects(readPhotoDevelopPresetPackV3(chunks(bytes), CATALOG));
	const empty = normalizePhotoDevelopPresetRowCurrentV1({ ...row, presets: [] }, CATALOG); assert.equal(empty.schemaVersion, 4);
	assert.equal(normalizePhotoDevelopPresetRowCurrentV1({ schemaVersion: 3, kind: 'photo-develop-presets', catalogId: CATALOG, revision: 1, presets: [] }, CATALOG).schemaVersion, 3);
});

test('Current pack rejects unused foreign mask inputs and joins iterator retirement while preserving an opaque failure', async () => {
	const source = recipe('recovery', true), changed = { ...source, masks: source.masks.map(mask => ({ ...mask,
		inputs: [...mask.inputs, { name: 'Foreign', kind: 'alpha', sourceRef: 'foreign-unused' }] })) };
	const settings = copyImageDevelopSelectedSettingsV4({ schemaVersion: 4, develop: changed, selection: FULL });
	const preset = createImageDevelopSelectedPresetV4({ schemaVersion: 4, id: 'foreign', name: 'Foreign declaration', settings });
	assert.throws(() => encodePhotoDevelopPresetPackCurrentV1({ schemaVersion: 4, kind: 'photo-develop-presets', catalogId: CATALOG, revision: 1, presets: [preset] }, CATALOG), /brush|reference/iu);
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const cleanup = new Error('Iterator retirement failed'); let left = 0;
	const sourceBytes: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return { next() { return Promise.reject(opaque.proxy); },
		return() { left++; return Promise.reject(cleanup); } }; } };
	const observed = await readPhotoDevelopPresetPackCurrentV1(sourceBytes, CATALOG).then(value => ({ value }), (error: unknown) => ({ error }));
	assert.ok('error' in observed); const error = observed.error; assert.ok(error instanceof AggregateError);
	assert.ok(Object.is(error.errors[0], opaque.proxy)); assert.ok(error.errors.some((value: unknown) => Object.is(value, opaque.proxy)));
	assert.ok(error.errors.some((value: unknown) => Object.is(value, cleanup))); assert.equal(left, 1);
});
