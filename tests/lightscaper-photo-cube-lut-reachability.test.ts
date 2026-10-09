/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { copyImageDevelopSettingsV2 } from '../src/common/editor/imaging/image-develop-settings-v2.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { createImageDevelopPresetV2 } from '../src/common/editor/imaging/image-develop-preset-v2.ts';
import { serializePhotoDocumentV1OrV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { createPhotoCubeLutReachabilityV1 } from '../src/lightscaper/catalog/photo-cube-lut-reachability-v1.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

const CREATED = '2026-10-09T00:00:00.000Z';
const all = { effectTypes: 'all' as const, geometry: true, localAdjustments: true };
function reference(index = 1) {
	const sha256 = index.toString(16).padStart(64, '0');
	return { storageKey: `lut-sha256:${sha256}`, sha256, byteLength: 73, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}
function develop(index = 1, enabled = false) {
	return { ...defaultImageDevelopStateV1(), processVersion: 2,
		effects: [{ id: `profile-${String(index)}`, type: 'cube-lut-profile-v1', enabled, params: { lut: reference(index) } }] };
}
function entry(value: unknown) { return { label: 'Recorded state', createdAt: CREATED, develop: value }; }
function completePhoto() {
	const { photo } = photoArchiveFixture(), original = photo.versions[0]!;
	return { ...photo, schemaVersion: 2, versions: [{ ...original,
		workspace: { schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 0,
			entries: [entry(original.develop), entry(develop(1)), entry(develop(2, true))],
			snapshots: [{ id: 'master-snapshot', name: 'Master snapshot', createdAt: CREATED, develop: develop(3) }] } },
	{ ...original, id: 'inactive-copy', kind: 'virtual-copy', name: 'Inactive copy', develop: develop(4),
		workspace: { schemaVersion: 2, kind: 'photo-develop-workspace', cursor: 0,
			entries: [entry(develop(4)), entry(develop(5, true))],
			snapshots: [{ id: 'copy-snapshot', name: 'Copy snapshot', createdAt: CREATED, develop: develop(6) }] } }] };
}
function preset(index: number, partial = false) {
	return createImageDevelopPresetV2({ schemaVersion: 2, id: `preset-${String(index)}`, name: 'LUT preset',
		settings: copyImageDevelopSettingsV2({ schemaVersion: 2, develop: develop(index),
			selection: partial ? { effectTypes: ['cube-lut-profile-v1'], geometry: false, localAdjustments: false } : all }) });
}

test('full admitted traversal retains inactive versions, disabled references, redo and snapshots plus full/partial presets', () => {
	const closure = createPhotoCubeLutReachabilityV1(), raw = completePhoto(), bytes = serializePhotoDocumentV1OrV2(raw);
	closure.addPhoto(raw); closure.addPreset(preset(7)); closure.addPreset(preset(8, true)); closure.addPhoto(raw);
	assert.equal(serializePhotoDocumentV1OrV2(raw), bytes);
	const copied = develop(4), original = photoArchiveFixture().photo;
	closure.addPhoto({ ...original, schemaVersion: 2, versions: [{ ...original.versions[0], develop: copied }] });
	copied.effects[0]!.params.lut.domainMin[0] = -1;
	const refs = closure.finish(); assert.deepEqual(refs, Array.from({ length: 8 }, (_, index) => reference(index + 1)));
	assert.equal(Object.isFrozen(refs), true); assert.equal(Object.isFrozen(refs[0]!.domainMin), true);
	assert.equal(closure.finish(), refs);
	assert.throws(() => closure.addPhoto(photoArchiveFixture().photo), /sealed/iu);
	assert.throws(() => closure.addPreset(preset(9)), /sealed/iu);
});

test('strict legacy documents and presets preserve bytes while explicit null profiles retain no body', () => {
	const closure = createPhotoCubeLutReachabilityV1(), photo = photoArchiveFixture().photo, before = serializePhotoDocumentV1OrV2(photo);
	closure.addPhoto(photo);
	closure.addPreset(createImageDevelopPresetV1({ schemaVersion: 1, id: 'old-preset', name: 'Old preset',
		settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(), selection: all }) }));
	closure.addPreset(createImageDevelopPresetV2({ schemaVersion: 2, id: 'neutral', name: 'Neutral',
		settings: copyImageDevelopSettingsV2({ schemaVersion: 2, selection: all,
			develop: { ...develop(), effects: [{ ...develop().effects[0], params: { lut: null } }] } }) }));
	assert.deepEqual(closure.finish(), []); assert.equal(serializePhotoDocumentV1OrV2(photo), before);
});

test('complete owning admission refuses future, incoherent, structural and accessor-bearing records before ledger mutation', () => {
	const closure = createPhotoCubeLutReachabilityV1(), raw = completePhoto(); let reads = 0;
	const accessor = Object.defineProperty({ ...raw }, 'versions', { enumerable: true, get() { reads++; return raw.versions; } });
	for (const value of [accessor, { ...raw, schemaVersion: 1 }, { ...raw, schemaVersion: 3 },
		{ ...raw, schemaFamily: 'framescaper' }, { ...raw, activeVersionId: 'missing' }, { ...raw, lutBytes: new Uint8Array(73) },
		{ ...raw, versions: [{ ...raw.versions[0], develop: develop() }] }]) assert.throws(() => closure.addPhoto(value));
	const saved = preset(1), presetAccessor = Object.defineProperty({ ...saved }, 'settings', { enumerable: true, get() { reads++; return saved.settings; } });
	for (const value of [presetAccessor, { ...saved, schemaVersion: 3 }, { ...saved, body: 'raw cube' },
		{ ...saved, identity: { ...saved.identity, authoredStateSha256: 'f'.repeat(64) } }]) assert.throws(() => closure.addPreset(value));
	assert.equal(reads, 0); assert.deepEqual(closure.finish(), []);
});

test('conflicting complete reference geometry anywhere in one photo is refused atomically', () => {
	const closure = createPhotoCubeLutReachabilityV1(); closure.addPreset(preset(20));
	for (const index of [1, 20]) {
		const raw = completePhoto(), conflicting = develop(index); conflicting.effects[0]!.params.lut.size = 3;
		raw.versions[1]!.workspace.snapshots[0]!.develop = conflicting;
		assert.throws(() => closure.addPhoto(raw), /conflict/iu);
	}
	assert.deepEqual(closure.finish(), [reference(20)]);
});

test('caller reflection cannot seal the ledger then publish an admitted photo or preset into it', () => {
	for (const kind of ['photo', 'preset']) {
		const closure = createPhotoCubeLutReachabilityV1(); let snapshot: ReturnType<typeof closure.finish> | null = null;
		const value = new Proxy(kind === 'photo' ? completePhoto() : preset(1), { ownKeys(target) {
			snapshot = closure.finish(); return Reflect.ownKeys(target);
		} });
		assert.throws(() => kind === 'photo' ? closure.addPhoto(value) : closure.addPreset(value), /sealed/iu);
		assert.deepEqual(snapshot, []); assert.equal(closure.finish(), snapshot);
	}
});

test('the shared entry capacity refuses a whole excess preset without partially adding its earlier references', () => {
	const closure = createPhotoCubeLutReachabilityV1();
	function group(start: number, count: number) {
		return createImageDevelopPresetV2({ schemaVersion: 2, id: `group-${String(start)}`, name: 'Group',
			settings: copyImageDevelopSettingsV2({ schemaVersion: 2, selection: all,
				develop: { ...develop(), effects: Array.from({ length: count }, (_, index) => develop(start + index).effects[0]!) } }) });
	}
	for (let start = 1; start <= 4094; start += 256) closure.addPreset(group(start, Math.min(256, 4095 - start)));
	closure.addPreset(preset(1)); assert.throws(() => closure.addPreset(group(4095, 2)), /capacity/iu);
	const refs = closure.finish(); assert.equal(refs.length, 4094); assert.deepEqual(refs.at(-1), reference(4094));
});

test('the mixed photo owner checks the unchanged aggregate document byte budget before traversal', () => {
	const { photo } = photoArchiveFixture();
	const large = { ...defaultImageDevelopStateV1(), effects: Array.from({ length: 256 }, (_, index) => ({
		id: `color-${String(index)}`, type: 'color-adjust', enabled: true, params: { brightness: 0.125 },
	})) };
	const workspace = { schemaVersion: 1, kind: 'photo-develop-workspace', cursor: 0, snapshots: [],
		entries: Array.from({ length: 40 }, () => entry(large)) };
	const version = { ...photo.versions[0], develop: large, workspace };
	const closure = createPhotoCubeLutReachabilityV1();
	assert.throws(() => closure.addPhoto({ ...photo, versions: [version, { ...version, id: 'copy', kind: 'virtual-copy' }] }), /byte budget/iu);
	assert.deepEqual(closure.finish(), []);
});
