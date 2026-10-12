/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1, type ImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { replaceImageDevelopRepairSpotsV1 } from '../src/common/editor/imaging/image-develop-repair-commands-v1.ts';
import { copyImageDevelopSettingsV2, normalizeImageDevelopSettingsPacketV1OrV2,
	mergeImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { createPhotoDevelopClipboardV2, normalizePhotoDevelopClipboardV1OrV2, parsePhotoDevelopClipboardV1OrV2,
	serializePhotoDevelopClipboardV1OrV2 } from '../src/lightscaper/controller/photo-develop-clipboard-v2.ts';

import type { ImageDevelopSelectionV3 as Selection3 } from '../src/common/editor/imaging/image-develop-settings-contract-v3.ts';
import { copyImageDevelopSettingsV3 as copy, normalizeImageDevelopSelectionV3, mergeImageDevelopSettingsV3 as merge, adjustImageDevelopSettingsV3 as adjust } from '../src/common/editor/imaging/image-develop-settings-v3.ts';
import { normalizeImageDevelopSettingsPacketCurrentV1 as normalizePacket } from '../src/common/editor/imaging/image-develop-settings-current-v1.ts';
import { copyImageDevelopSelectedSettingsV3 as selectedCopy, mergeImageDevelopSelectedSettingsV3 as selectedMerge } from '../src/common/editor/imaging/image-develop-settings-selected-v3.ts';
import { createPhotoDevelopClipboardCurrentV1 as createClipboard, parsePhotoDevelopClipboardCurrentV1 as parseClipboard, serializePhotoDevelopClipboardCurrentV1 as serializeClipboard } from '../src/lightscaper/controller/photo-develop-clipboard-current-v1.ts';
import { normalizeImageDevelopSelectionForProfileV1, copyImageDevelopSettingsForProfileV1, normalizeImageDevelopSettingsPacketForProfileV1,
	normalizeImageDevelopSettingsPacketCurrentForProfileV1, mergeImageDevelopSettingsForProfileV1, adjustImageDevelopSettingsForProfileV1 } from '../src/common/editor/imaging/internal/image-develop-settings-kernel-v1.ts';
import { createPhotoDevelopClipboardForProfileV1, normalizePhotoDevelopClipboardForProfileV1,
	normalizePhotoDevelopClipboardCurrentForProfileV1 } from '../src/lightscaper/controller/internal/photo-develop-clipboard-kernel-v1.ts';

// Initial RED reached the real strict legacy owners. These successor imports
// exercise the same value assertions after Root captured that owning refusal.
const FULL: Selection3 = { effectTypes: 'all', geometry: true, localAdjustments: true, repairs: true };
const REPAIRS: Selection3 = { effectTypes: [], geometry: false, localAdjustments: false, repairs: true };
const invoke = <Result>(owner: (...args: never[]) => unknown, ...args: unknown[]): Result => Reflect.apply(owner, undefined, args) as Result;
const sha = (value: string) => value.repeat(64);
function repair(id: string, mode: 'clone' | 'heal' = 'clone') {
	return { id, mode, enabled: mode === 'clone', target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 0.15, feather: 0.25, opacity: 0.5 };
}
function recipe(brush = false) {
	const masks = [{ schemaVersion: 2, id: 'matte', kind: 'matte', name: 'Named adjustment', inputs: [],
		nodes: [{ id: 'out', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }], outputNodeId: 'out' }];
	const external = { schemaVersion: 2, id: 'brush', kind: 'mask', name: 'Retained brush', inputs: [
		{ name: 'Paint', sourceRef: `brush-mask-v1:2:1:${sha('a')}`, kind: 'raster' }, { name: 'Unused', sourceRef: `brush-mask-v1:1:1:${sha('b')}`, kind: 'raster' }],
		nodes: [{ id: 'alpha', kind: 'raster', inputName: 'Paint', channel: 'alpha' }], outputNodeId: 'alpha' };
	return replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV2(), effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: 1 } }),
		{ id: 'profile', type: 'cube-lut-profile-v1', enabled: false, params: { lut: { storageKey: `lut-sha256:${sha('c')}`, sha256: sha('c'),
			byteLength: 88, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }], masks: brush ? [...masks, external] : masks,
		maskBindings: [{ effectId: 'tone', maskId: 'matte' }] }, { schemaVersion: 1, spots: [repair('first'), repair('second', 'heal')] });
}
function request(develop: unknown, selection: Selection3 = FULL) { return { schemaVersion: 3, develop, selection }; }
function toneParams(develop: Readonly<ImageDevelopStateCurrentV1>): unknown {
	const effect = develop.effects.find(item => item.id === 'tone'); assert.ok(effect); return effect.params;
}

test('full Current settings copy retains exact ordered Clone and Heal with mandatory selected repairs', () => {
	const source = recipe(), packet = copy(request(source));
	assert.equal(packet.schemaVersion, 3); assert.equal(packet.kind, 'photo-develop-settings'); assert.deepEqual(packet.selection, FULL);
	assert.deepEqual(packet.develop, source); assert.ok(Object.isFrozen(packet)); assert.ok(Object.isFrozen(packet.develop));
	assert.deepEqual(normalizePacket(structuredClone(packet)), packet);
});

test('unselected repairs copy an empty bounded group while retaining the explicit source process3', () => {
	const source = recipe(), packet = copy(request(source, { ...FULL, repairs: false }));
	assert.equal(packet.develop.processVersion, 3); if (packet.develop.processVersion !== 3) assert.fail('Expected process3.');
	assert.deepEqual(packet.develop.repairs, { schemaVersion: 1, spots: [] }); assert.deepEqual(packet.develop.effects, source.effects);
	assert.deepEqual(packet.develop.masks, source.masks); assert.deepEqual(packet.develop.maskBindings, source.maskBindings);
});

test('repair-only paste replaces the complete ordered list without changing unselected effects, geometry or masks', () => {
	const target = recipe(), donor = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [repair('heal-first', 'heal'), repair('clone-second')] });
	const settings = copy(request(donor, REPAIRS)), result = merge({ schemaVersion: 3, target, settings });
	assert.equal(result.processVersion, 3); if (result.processVersion !== 3) assert.fail('Expected process3.');
	assert.deepEqual(result.repairs, donor.repairs); assert.deepEqual(result.effects, target.effects); assert.deepEqual(result.geometry, target.geometry);
	assert.deepEqual(result.masks, target.masks); assert.deepEqual(result.maskBindings, target.maskBindings);
});

test('explicit repair clear keeps process3 and promotes legacy targets through the explicit repair edit', () => {
	const empty = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots: [] }), settings = copy(request(empty, REPAIRS));
	for (const target of [recipe(), defaultImageDevelopStateV1(), defaultImageDevelopStateV2()]) {
		const result = merge({ schemaVersion: 3, target, settings }); assert.equal(result.processVersion, 3);
		if (result.processVersion !== 3) assert.fail('Expected sticky3.'); assert.deepEqual(result.repairs.spots, []);
	}
});

test('legacy packet paste leaves all target repairs exact rather than treating absent selection as clear', () => {
	const target = recipe(true), source = normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(),
		effects: [createVideoEffect('tone-ladder-v1', { id: 'donor-tone', params: { exposure: 2 } })] });
	const settings = copyImageDevelopSettingsV2({ schemaVersion: 2, develop: source, selection: { effectTypes: ['tone-ladder-v1'], geometry: false, localAdjustments: false } });
	const result = merge({ schemaVersion: 3, target, settings }); assert.equal(result.processVersion, 3);
	if (result.processVersion !== 3) assert.fail('Expected sticky3.'); assert.deepEqual(result.repairs, target.repairs);
	assert.deepEqual(result.masks, target.masks); assert.deepEqual(result.effects.find(item => item.id === 'profile'), target.effects.find(item => item.id === 'profile'));
});

test('global-only Current paste and quick relative edits preserve target repair and brush identities', () => {
	const target = recipe(true), source = replaceImageDevelopRepairSpotsV1({ ...defaultImageDevelopStateV2(),
		effects: [createVideoEffect('tone-ladder-v1', { id: 'new-global', params: { exposure: 2 } })] }, { schemaVersion: 1, spots: [repair('ignored')] });
	const settings = copy(request(source, { effectTypes: ['tone-ladder-v1'], geometry: false, localAdjustments: false, repairs: false }));
	const pasted = merge({ schemaVersion: 3, target, settings }); assert.equal(pasted.processVersion, 3);
	if (pasted.processVersion !== 3) assert.fail('Expected process3.'); assert.deepEqual(pasted.repairs, target.repairs); assert.deepEqual(pasted.masks, target.masks);
	const changed = adjust({ schemaVersion: 3, target, effectType: 'tone-ladder-v1', changes: { exposure: 0.25 } });
	assert.equal(changed.processVersion, 3); if (changed.processVersion !== 3) assert.fail('Expected process3.');
	assert.deepEqual(changed.repairs, target.repairs); assert.deepEqual(changed.masks, target.masks); assert.deepEqual(changed.maskBindings, target.maskBindings);
	assert.deepEqual(changed.effects.find(item => item.id === 'profile'), target.effects.find(item => item.id === 'profile'));
	// The bound tone remains exact; quick-develop creates/edits only a global instance.
	assert.deepEqual(toneParams(changed), toneParams(target)); assert.equal(changed.effects.length, target.effects.length + 1);
});

test('zero relative changes retain byte-exact complete Current metadata without promotion or truncation', () => {
	for (const target of [defaultImageDevelopStateV1(), defaultImageDevelopStateV2(), recipe(true), replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV1(), { schemaVersion: 1, spots: [] })]) {
		const result = adjust({ schemaVersion: 3, target, effectType: 'tone-ladder-v1', changes: { exposure: 0 } });
		assert.equal(JSON.stringify(result), JSON.stringify(target)); assert.equal(result.processVersion, target.processVersion);
	}
});

test('selected scalar copying retains complete named brush declarations and repair order without granting body authority', () => {
	const source = recipe(true), packet = selectedCopy(request(source));
	assert.deepEqual(packet.develop, source); assert.deepEqual(packet.selection, FULL);
	assert.deepEqual(packet.develop.masks.find(mask => mask.id === 'brush'), source.masks.find(mask => mask.id === 'brush'));
	assert.deepEqual(Object.keys(packet).sort(), ['develop', 'kind', 'schemaVersion', 'selection']);
	const target = recipe(), result = selectedMerge({ schemaVersion: 3, target, settings: packet }); assert.deepEqual(result, source);
});

test('Current local-only copy and paste replace the complete local group while global-only selection preserves it', () => {
	const source = recipe(true), selection: Selection3 = { effectTypes: [], geometry: false, localAdjustments: true, repairs: false };
	const packet = selectedCopy(request(source, selection));
	assert.deepEqual(packet.develop.effects, [source.effects.find(effect => effect.id === 'tone')]);
	assert.deepEqual(packet.develop.masks, source.masks); assert.deepEqual(packet.develop.maskBindings, source.maskBindings);
	const target = replaceImageDevelopRepairSpotsV1({ ...recipe(), effects: [...recipe().effects,
		createVideoEffect('tone-ladder-v1', { id: 'target-global', params: { exposure: -1 } })] }, { schemaVersion: 1, spots: [repair('retained-target')] });
	const pasted = selectedMerge({ schemaVersion: 3, target, settings: packet });
	assert.deepEqual(pasted.masks, source.masks); assert.deepEqual(pasted.maskBindings, source.maskBindings);
	assert.deepEqual(pasted.effects, target.effects); assert.equal(pasted.processVersion, 3);
	if (pasted.processVersion !== 3) assert.fail('Expected process3.'); assert.deepEqual(pasted.repairs, target.repairs);
	const donor = { ...recipe(), effects: [...recipe().effects, createVideoEffect('tone-ladder-v1', { id: 'donor-global', params: { exposure: 2 } })] };
	const globalPacket = copy(request(donor, { effectTypes: ['tone-ladder-v1'], geometry: false, localAdjustments: false, repairs: false }));
	assert.deepEqual(globalPacket.develop.effects.map(effect => effect.id), ['donor-global']); assert.deepEqual(globalPacket.develop.masks, []);
	const globalPaste = merge({ schemaVersion: 3, target: pasted, settings: globalPacket });
	assert.deepEqual(globalPaste.masks, pasted.masks); assert.deepEqual(globalPaste.maskBindings, pasted.maskBindings);
	assert.deepEqual(globalPaste.effects.find(effect => effect.id === 'tone'), pasted.effects.find(effect => effect.id === 'tone'));
	assert.equal(globalPaste.processVersion, 3); if (globalPaste.processVersion !== 3) assert.fail('Expected sticky3.'); assert.deepEqual(globalPaste.repairs, pasted.repairs);
});

test('ordinary settings copy and external whole-clipboard JSON refuse brush references without blanking graphs', () => {
	const source = recipe(true), input = structuredClone(source);
	assert.throws(() => copy(request(source)), /external|authenticated|brush/iu);
	assert.throws(() => createClipboard(source), /external|authenticated|brush/iu);
	assert.throws(() => parseClipboard(JSON.stringify({ schemaFamily: 'lightscaper', schemaVersion: 3, kind: 'photo-develop-clipboard', develop: source })), /external|authenticated|brush/iu);
	assert.deepEqual(source, input);
});

test('whole Clipboard3 roundtrip retains exact process3 recipes and refuses old strict wire readers', () => {
	const source = recipe(), packet = createClipboard(source), text = serializeClipboard(packet);
	assert.equal(packet.schemaVersion, 3); assert.equal(packet.develop.processVersion, 3); assert.deepEqual(packet.develop, source);
	assert.deepEqual(parseClipboard(text), packet); assert.equal(serializeClipboard(parseClipboard(text)), text);
	assert.throws(() => normalizePhotoDevelopClipboardV1OrV2(packet)); assert.throws(() => createPhotoDevelopClipboardV2(source));
});

test('selection requires an own repairs boolean and all closed readers reject accessors without invoking hooks', () => {
	const source = recipe(); let reads = 0;
	const selection = { effectTypes: 'all', geometry: true, localAdjustments: true };
	assert.throws(() => invoke(normalizeImageDevelopSelectionV3, selection));
	for (const value of [{ ...FULL, repairs: undefined }, { ...FULL, repairs: 1 }, { ...FULL, extra: true },
		Object.defineProperty({ ...FULL }, 'repairs', { enumerable: true, get() { reads++; return true; } })]) {
		assert.throws(() => copy(request(source, value as Selection3)));
	}
	for (const value of [Object.defineProperty(request(source), 'develop', { enumerable: true, get() { reads++; return source; } }),
		{ ...request(source), [Symbol('extra')]: true }, Object.assign(Object.create({ inherited: true }) as object, request(source)), { ...request(source), body: new Blob() }]) assert.throws(() => copy(value));
	assert.equal(reads, 0);
});

test('Current readers reject future settings, process, clipboard versions and invalid repair definitions', () => {
	const source = recipe(), packet = { schemaVersion: 3, kind: 'photo-develop-settings', selection: FULL, develop: source };
	for (const value of [{ ...packet, schemaVersion: 4 }, { ...packet, develop: { ...source, processVersion: 4 } },
		{ ...packet, develop: { ...source, repairs: { schemaVersion: 2, spots: [] } } },
		{ ...packet, develop: { ...source, repairs: { schemaVersion: 1, spots: [{ ...repair('bad'), opacity: 2 }] } } }]) assert.throws(() => normalizePacket(value));
	assert.throws(() => parseClipboard(JSON.stringify({ schemaFamily: 'lightscaper', schemaVersion: 4, kind: 'photo-develop-clipboard', develop: source })));
});

test('the complete 64-spot list is retained while a 65th declared disabled spot refuses atomically', () => {
	const spots = Array.from({ length: 64 }, (_, index) => ({ ...repair(`spot-${String(index)}`, index % 2 ? 'heal' : 'clone'), enabled: false }));
	const source = replaceImageDevelopRepairSpotsV1(defaultImageDevelopStateV2(), { schemaVersion: 1, spots }), packet = copy(request(source));
	assert.equal(packet.develop.processVersion, 3); if (packet.develop.processVersion !== 3) assert.fail('Expected process3.'); assert.deepEqual(packet.develop.repairs.spots, spots);
	assert.throws(() => copy(request({ ...source, repairs: { schemaVersion: 1, spots: [...spots, repair('extra', 'heal')] } })));
	assert.equal(source.repairs.spots.length, 64);
});

test('normalized settings enforce 2 MiB metadata capacity and Clipboard3 checks UTF8 before JSON parsing', () => {
	const masks = Array.from({ length: 12 }, (_, graph) => ({ schemaVersion: 1, id: `graph-${String(graph)}`, kind: 'mask', inputs: [],
		nodes: Array.from({ length: 4096 }, (_, node) => ({ id: `complete-unused-definition-${String(node).padStart(4, '0')}`, kind: 'linear-gradient',
			start: { x: 0, y: 0 }, end: { x: 1, y: 1 } })), outputNodeId: 'complete-unused-definition-0000' }));
	const oversized = { ...recipe(), masks, maskBindings: [] };
	assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength > 2_097_152); assert.throws(() => copy(request(oversized)), /byte|budget|maximum/iu);
	const packet = { schemaFamily: 'lightscaper', schemaVersion: 3, kind: 'photo-develop-clipboard', develop: recipe() }, text = JSON.stringify(packet);
	const padded = text + ' '.repeat(2_097_152 - new TextEncoder().encode(text).byteLength);
	assert.deepEqual(parseClipboard(padded), packet);
	assert.throws(() => parseClipboard(`${padded} `), /byte budget/iu); assert.throws(() => parseClipboard(`"${'é'.repeat(1_048_576)}"`), /byte budget/iu);
});

test('permanent legacy packet and whole clipboard bytes remain exact and refuse repaired recipes', () => {
	const develop = defaultImageDevelopStateV2(), selection = { effectTypes: 'all', geometry: true, localAdjustments: true };
	const packet = copyImageDevelopSettingsV2({ schemaVersion: 2, develop, selection });
	assert.equal(JSON.stringify(normalizeImageDevelopSettingsPacketV1OrV2(structuredClone(packet))), JSON.stringify(packet));
	const clipboard = createPhotoDevelopClipboardV2(develop), text = serializePhotoDevelopClipboardV1OrV2(clipboard);
	assert.equal(serializePhotoDevelopClipboardV1OrV2(parsePhotoDevelopClipboardV1OrV2(text)), text);
	assert.throws(() => copyImageDevelopSettingsV2({ schemaVersion: 2, develop: recipe(), selection }));
	assert.throws(() => mergeImageDevelopSettingsV2({ schemaVersion: 2, target: recipe(), settings: packet }));
	const external = normalizeImageDevelopStateCurrentV1({ ...develop, masks: recipe(true).masks });
	assert.throws(() => createPhotoDevelopClipboardV2(external), /external|authenticated/iu);
});

test('fixed settings kernels refuse an unknown profile before reflecting request or selection metadata', () => {
	let reflected = 0;
	const hostile = new Proxy({}, { ownKeys() { reflected++; throw new Error('Settings metadata reflected before profile admission.'); },
		getOwnPropertyDescriptor() { reflected++; throw new Error('Settings field reflected before profile admission.'); } });
	for (const owner of [normalizeImageDevelopSelectionForProfileV1, copyImageDevelopSettingsForProfileV1,
		normalizeImageDevelopSettingsPacketForProfileV1, normalizeImageDevelopSettingsPacketCurrentForProfileV1,
		mergeImageDevelopSettingsForProfileV1, adjustImageDevelopSettingsForProfileV1]) {
		assert.throws(() => Reflect.apply(owner, undefined, ['future-profile', hostile]), /profile/iu);
		assert.equal(reflected, 0);
	}
});

test('fixed whole-clipboard kernels refuse an unknown profile before reflecting recipe or envelope metadata', () => {
	let reflected = 0;
	const hostile = new Proxy({}, { ownKeys() { reflected++; throw new Error('Clipboard metadata reflected before profile admission.'); },
		getOwnPropertyDescriptor() { reflected++; throw new Error('Clipboard field reflected before profile admission.'); } });
	for (const owner of [createPhotoDevelopClipboardForProfileV1, normalizePhotoDevelopClipboardForProfileV1, normalizePhotoDevelopClipboardCurrentForProfileV1]) {
		assert.throws(() => Reflect.apply(owner, undefined, ['future-profile', hostile]), /profile/iu);
		assert.equal(reflected, 0);
	}
});
