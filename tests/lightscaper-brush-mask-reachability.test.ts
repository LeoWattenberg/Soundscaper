/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { admitImageDevelopMaskAuthorityV1 } from '../src/common/editor/imaging/image-develop-mask-plan-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { copyImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { createImageDevelopPresetV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoMaskRasterReachabilityV1 } from '../src/lightscaper/catalog/photo-mask-raster-reachability-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { assertDeepFrozen } from './helpers/frozen-contract-assertions.ts';

const CREATED = '2026-10-11T00:00:00.000Z';
const ALL = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
const digest = (index: number) => index.toString(16).padStart(64, '0');
function reference(index: number, width = 1): BrushMaskResourceReferenceV1 {
	const sha256 = digest(index);
	return { storageKey: `brush-mask-v1:${String(width)}:1:${sha256}`, sha256, width, height: 1, byteLength: 16 + width };
}
function graph(index: number, width = 1) {
	return { schemaVersion: 1, id: `brush-${String(index)}`, kind: 'mask',
		inputs: [{ name: 'Brush', sourceRef: reference(index, width).storageKey, kind: 'raster' }],
		nodes: [{ id: 'output', kind: 'raster', inputName: 'Brush', channel: 'alpha' }], outputNodeId: 'output' };
}
function brushDevelop(index: number, enabled = false, bound = true, width = 1) {
	return { ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: 'tone', type: 'tone-ladder-v1', enabled, params: { exposure: 1 } }],
		masks: [graph(index, width)], maskBindings: bound ? [{ effectId: 'tone', maskId: `brush-${String(index)}` }] : [] };
}
function lut(index: number, size = 2) {
	return { storageKey: `lut-sha256:${digest(index)}`, sha256: digest(index), byteLength: 73,
		size, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
function lutDevelop(index: number, size = 2) {
	return { ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: `profile-${String(index)}`, type: 'cube-lut-profile-v1', enabled: false, params: { lut: lut(index, size) } }] };
}
function entry(develop: unknown) { return { label: 'Retained edit', createdAt: CREATED, develop }; }
function completePhoto() {
	const { photo } = photoArchiveFixture(), original = photo.versions[0]!;
	const inactive = brushDevelop(4, false, false);
	inactive.masks[0]!.inputs.push({ name: 'Unused', sourceRef: reference(7).storageKey, kind: 'raster' });
	return { ...photo, schemaVersion: 2, versions: [{ ...original,
		workspace: { schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 0,
			entries: [entry(original.develop), entry(brushDevelop(1)), entry(brushDevelop(2, true))],
			snapshots: [{ id: 'master-snapshot', name: 'Master snapshot', createdAt: CREATED, develop: brushDevelop(3) }] } },
	{ ...original, id: 'inactive-copy', kind: 'virtual-copy', name: 'Inactive copy', develop: inactive,
		workspace: { schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 0,
			entries: [entry(inactive), entry(brushDevelop(5, true))],
			snapshots: [{ id: 'copy-snapshot', name: 'Copy snapshot', createdAt: CREATED, develop: brushDevelop(6) }] } }] };
}
function lutPreset(index: number, partial = false) {
	return createImageDevelopPresetV2({ schemaVersion: 2, id: `preset-${String(index)}`, name: 'Retained LUT',
		settings: copyImageDevelopSettingsV2({ schemaVersion: 2, develop: lutDevelop(index),
			selection: partial ? { effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false } : ALL }) });
}

test('complete real Photo traversal retains inactive, disabled, unbound, unused-input, redo and snapshot brush references', () => {
	const closure = createPhotoMaskRasterReachabilityV1(), photo = completePhoto(), before = serializePhotoDocumentV1OrV2(photo);
	closure.addPhoto(photo); closure.addPhoto(photo);
	assert.equal(serializePhotoDocumentV1OrV2(photo), before);
	const references = closure.finish();
	assert.deepEqual(references, Array.from({ length: 7 }, (_, index) => reference(index + 1)));
	assertDeepFrozen(references); assert.equal(closure.finish(), references);
	assert.throws(() => closure.addPhoto(photoArchiveFixture().photo), /sealed/iu);
	assert.throws(() => closure.addDevelop(defaultImageDevelopStateV1()), /sealed/iu);
	assert.throws(() => closure.addPreset(lutPreset(1)), /sealed/iu);
});

test('owning develop admission retains all declared raster and alpha inputs, including an unreachable input and unbound range graph', () => {
	const closure = createPhotoMaskRasterReachabilityV1(), develop = brushDevelop(8, false, false);
	const value = { ...develop, masks: [{ ...develop.masks[0], inputs: [
		{ name: 'Brush', sourceRef: reference(8).storageKey, kind: 'alpha' },
		{ name: 'Unused', sourceRef: reference(9).storageKey, kind: 'raster' }],
		nodes: [{ id: 'output', kind: 'alpha', inputName: 'Brush' }] },
	{ schemaVersion: 1, id: 'range', kind: 'matte', inputs: [],
		nodes: [{ id: 'range-output', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 }], outputNodeId: 'range-output' }] };
	closure.addDevelop(value); assert.deepEqual(closure.finish(), [reference(8), reference(9)]);
});

test('collection detaches caller data and emits only frozen scalar identity, never recipe or body authority', () => {
	const closure = createPhotoMaskRasterReachabilityV1(), value = brushDevelop(11);
	closure.addDevelop(value); value.masks[0]!.inputs[0]!.sourceRef = reference(12).storageKey;
	const references = closure.finish(); assert.deepEqual(references, [reference(11)]); assertDeepFrozen(references);
	assert.deepEqual(Object.keys(references[0]!).sort(), ['storageKey', 'sha256', 'width', 'height', 'byteLength'].sort());
});

test('legacy no-resource documents, neutral graphs and full/partial LUT presets preserve actual bytes', () => {
	const closure = createPhotoMaskRasterReachabilityV1(), photo = photoArchiveFixture().photo, before = serializePhotoDocumentV1OrV2(photo);
	closure.addPhoto(photo); closure.addDevelop(defaultImageDevelopStateV1());
	closure.addPreset(createImageDevelopPresetV1({ schemaVersion: 1, id: 'legacy', name: 'Legacy',
		settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(), selection: ALL }) }));
	closure.addPreset(lutPreset(1)); closure.addPreset(lutPreset(2, true));
	assert.deepEqual(closure.finish(), []); assert.equal(serializePhotoDocumentV1OrV2(photo), before);
});

test('the real settings adapter still refuses brush presets before persistence; no fabricated resource preset is admitted', () => {
	const closure = createPhotoMaskRasterReachabilityV1(), develop = brushDevelop(1);
	for (const selection of [ALL, { effectTypes: ['tone-ladder-v1'], geometry: false, localAdjustments: true }]) {
		assert.throws(() => copyImageDevelopSettingsV2({ schemaVersion: 2, develop, selection }), /authenticated settings adapter/iu);
		assert.throws(() => createImageDevelopPresetV2({ schemaVersion: 2, id: 'brush-preset', name: 'Brush preset',
			settings: { schemaVersion: 2, kind: 'photo-develop-settings', develop, selection } }), /authenticated settings adapter/iu);
	}
	assert.deepEqual(closure.finish(), []);
});

test('nonbrush source IDs confer no brush resource identity and owning rendering keeps its external authority refusal', () => {
	const closure = createPhotoMaskRasterReachabilityV1(), develop = brushDevelop(1);
	develop.masks[0]!.inputs[0]!.sourceRef = 'existing-video-source';
	closure.addDevelop(develop); assert.deepEqual(closure.finish(), []);
	assert.throws(() => admitImageDevelopMaskAuthorityV1(develop), /authenticated media authority/iu);
});

test('reserved malformed and future namespace references refuse without partially changing the ledger', () => {
	const closure = createPhotoMaskRasterReachabilityV1(); closure.addDevelop(brushDevelop(30));
	for (const sourceRef of [`brush-mask-v2:1:1:${digest(1)}`, `brush-mask-v1:01:1:${digest(1)}`,
		`brush-mask-v1:0:1:${digest(1)}`, `brush-mask-v1:1025:1:${digest(1)}`, `brush-mask-v1:1:1:${digest(1).toUpperCase().replace('1', 'A')}`,
		`brush-mask-v1:1:1:${'a'.repeat(63)}`, 'brush-mask-future']) {
		const value = brushDevelop(31); value.masks[0]!.inputs.push({ name: 'Malformed', sourceRef, kind: 'raster' });
		assert.throws(() => closure.addDevelop(value));
	}
	assert.deepEqual(closure.finish(), [reference(30)]);
});

test('complete owning Photo/preset/develop admission rejects getters, future fields and incoherent history before mutation', () => {
	const closure = createPhotoMaskRasterReachabilityV1(), photo = completePhoto(); let reads = 0;
	const accessor = Object.defineProperty({ ...photo }, 'versions', { enumerable: true, get() { reads++; return photo.versions; } });
	for (const value of [accessor, { ...photo, schemaVersion: 3 }, { ...photo, schemaFamily: 'framescaper' },
		{ ...photo, activeVersionId: 'missing' }, { ...photo, body: new Uint8Array(17) },
		{ ...photo, versions: [{ ...photo.versions[0], develop: brushDevelop(40) }] }]) assert.throws(() => closure.addPhoto(value));
	const develop = brushDevelop(1), masks = Object.defineProperty({ ...develop }, 'masks', { enumerable: true, get() { reads++; return develop.masks; } });
	for (const value of [masks, { ...develop, processVersion: 3 }, { ...develop, body: 'alpha' }]) assert.throws(() => closure.addDevelop(value));
	const preset = lutPreset(1), settings = Object.defineProperty({ ...preset }, 'settings', { enumerable: true, get() { reads++; return preset.settings; } });
	for (const value of [settings, { ...preset, schemaVersion: 3 }, { ...preset, body: 'cube' },
		{ ...preset, identity: { ...preset.identity, authoredStateSha256: 'f'.repeat(64) } }]) assert.throws(() => closure.addPreset(value));
	assert.equal(reads, 0); assert.deepEqual(closure.finish(), []);
});

test('same brush digest with conflicting dimensions in a retained snapshot refuses the entire Photo atomically', () => {
	const closure = createPhotoMaskRasterReachabilityV1(); closure.addDevelop(brushDevelop(20));
	for (const index of [1, 20]) {
		const photo = completePhoto(); photo.versions[1]!.workspace.snapshots[0]!.develop = brushDevelop(index, false, true, 2);
		assert.throws(() => closure.addPhoto(photo), /conflict/iu);
	}
	assert.deepEqual(closure.finish(), [reference(20)]);
});

test('a failed mixed packet mutates neither the retained brush ledger nor companion LUT capacity/identity', () => {
	const closure = createPhotoMaskRasterReachabilityV1(); closure.addDevelop(brushDevelop(1));
	const value = { ...lutDevelop(100), masks: [graph(2), { ...graph(3), inputs: [
		{ name: 'Brush', sourceRef: `brush-mask-v2:1:1:${digest(3)}`, kind: 'raster' }] }] };
	assert.throws(() => closure.addDevelop(value));
	assert.doesNotThrow(() => closure.addDevelop(lutDevelop(100, 3)));
	assert.doesNotThrow(() => closure.addDevelop(brushDevelop(2, false, true, 2)));
	assert.deepEqual(closure.finish(), [reference(1), reference(2, 2)]);
});

test('companion LUT conflicts make a whole mixed Photo atomic rather than publishing its earlier brush refs', () => {
	const closure = createPhotoMaskRasterReachabilityV1(); closure.addPreset(lutPreset(50));
	const photo = completePhoto(), retained = photo.versions[1]!;
	const conflicting = { ...photo, versions: [photo.versions[0], { ...retained,
		workspace: { ...retained.workspace, snapshots: [{ ...retained.workspace.snapshots[0], develop: lutDevelop(50, 3) }] } }] };
	assert.throws(() => closure.addPhoto(conflicting), /conflict/iu);
	assert.deepEqual(closure.finish(), []);
});

test('caller reflection cannot finish then publish a Photo, develop or preset into the sealed ledger', () => {
	for (const kind of ['photo', 'develop', 'preset'] as const) {
		const closure = createPhotoMaskRasterReachabilityV1(); let snapshot: ReturnType<typeof closure.finish> | undefined;
		const raw = kind === 'photo' ? completePhoto() : kind === 'develop' ? brushDevelop(1) : lutPreset(1);
		const value = new Proxy(raw, { ownKeys(target) { snapshot = closure.finish(); return Reflect.ownKeys(target); } });
		assert.throws(() => kind === 'photo' ? closure.addPhoto(value) : kind === 'develop' ? closure.addDevelop(value) : closure.addPreset(value), /sealed/iu);
		assert.deepEqual(snapshot, []); assert.equal(closure.finish(), snapshot);
	}
});

function mixedGroup(start: number, count: number) {
	const indexes = Array.from({ length: count }, (_, index) => start + index), first = indexes[0]!;
	return { ...lutDevelop(first), effects: indexes.map(index => lutDevelop(index).effects[0]!),
		masks: [{ ...graph(first), inputs: indexes.map(index => ({ name: `Brush${String(index)}`, sourceRef: reference(index).storageKey, kind: 'raster' })),
			nodes: [{ id: 'output', kind: 'raster', inputName: `Brush${String(first)}`, channel: 'alpha' }] }] };
}
test('LUT and brush refs share the unchanged 4094-entry capacity, rather than receiving separate allowances', () => {
	const closure = createPhotoMaskRasterReachabilityV1();
	for (let start = 1; start <= 2047; start += 256) closure.addDevelop(mixedGroup(start, Math.min(256, 2048 - start)));
	closure.addDevelop(mixedGroup(1, 1));
	assert.throws(() => closure.addDevelop(lutDevelop(2048)), /capacity/iu);
	assert.throws(() => closure.addDevelop(brushDevelop(2048)), /capacity/iu);
	assert.throws(() => closure.addDevelop(mixedGroup(2048, 2)), /capacity/iu);
	const references = closure.finish(); assert.equal(references.length, 2047);
	assert.deepEqual(references[0], reference(1)); assert.deepEqual(references.at(-1), reference(2047));
});

test('actual aggregate Photo byte admission still precedes traversal instead of using an independent resource-only document', () => {
	const { photo } = photoArchiveFixture();
	const large = { ...brushDevelop(1), effects: Array.from({ length: 256 }, (_, index) => ({
		id: `color-${String(index)}`, type: 'color-adjust', enabled: true, params: { brightness: 0.125 } })), maskBindings: [] };
	const workspace = { schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 0, snapshots: [],
		entries: Array.from({ length: 40 }, () => entry(large)) };
	const version = { ...photo.versions[0], develop: large, workspace }, closure = createPhotoMaskRasterReachabilityV1();
	assert.throws(() => closure.addPhoto({ ...photo, schemaVersion: 2,
		versions: [version, { ...version, id: 'copy', kind: 'virtual-copy' }] }), /byte budget/iu);
	assert.deepEqual(closure.finish(), []);
});
