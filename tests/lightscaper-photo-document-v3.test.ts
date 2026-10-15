/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeImageDevelopStateV3 } from '../src/common/editor/imaging/image-develop-state-v3.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoDocumentV2, normalizePhotoDocumentV1OrV2, serializePhotoDocumentV1OrV2, upgradePhotoDocumentV2 } from '../src/lightscaper/catalog/photo-document-v2.ts';
import { normalizePhotoDocumentV3 } from '../src/lightscaper/catalog/photo-document-v3.ts';
import { normalizePhotoDocumentCurrentV1, parsePhotoDocumentCurrentV1, serializePhotoDocumentCurrentV1, upgradePhotoDocumentV3 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { createPhotoDevelopWorkspaceV1, serializePhotoDevelopWorkspaceV1, normalizePhotoDevelopWorkspaceV1 } from '../src/lightscaper/catalog/photo-develop-workspace-v1.ts';
import { createPhotoDevelopWorkspaceV2, serializePhotoDevelopWorkspaceV1OrV2, normalizePhotoDevelopWorkspaceV1OrV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';
import { normalizePhotoDevelopWorkspaceV3 } from '../src/lightscaper/catalog/photo-develop-workspace-v3.ts';
import { createPhotoDevelopWorkspaceCurrentV1, commitPhotoDevelopWorkspaceCurrentV1, normalizePhotoDevelopWorkspaceCurrentV1,
	parsePhotoDevelopWorkspaceCurrentV1, serializePhotoDevelopWorkspaceCurrentV1, upgradePhotoDevelopWorkspaceV3,
	selectPhotoDevelopHistoryCurrentV1, savePhotoDevelopSnapshotCurrentV1, restorePhotoDevelopSnapshotCurrentV1,
	deletePhotoDevelopSnapshotCurrentV1 } from '../src/lightscaper/catalog/photo-develop-workspace-current-v1.ts';

const CREATED = '2026-10-09T00:00:00.000Z', SHA = 'a'.repeat(64), BRUSH = `brush-mask-v1:2:1:${'b'.repeat(64)}`;
const step = (label: string) => ({ label, createdAt: CREATED });
function repair(enabled = true, identifier = 'spot') {
	return { ...defaultImageDevelopStateV1(), processVersion: 3,
		effects: [{ id: 'lut', type: 'cube-lut-profile-v1', enabled: false, params: { lut: { storageKey: `lut-sha256:${SHA}`,
			sha256: SHA, byteLength: 83, size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] } } }],
		masks: [{ schemaVersion: 2, id: 'named', name: 'Retained matte', kind: 'matte',
			inputs: [{ name: 'Paint', kind: 'alpha', sourceRef: BRUSH }, { name: 'Unused', kind: 'raster', sourceRef: 'external-unused' }],
			nodes: [{ id: 'paint', kind: 'alpha', inputName: 'Paint' }, { id: 'unused', kind: 'raster', inputName: 'Unused', channel: 'red' }], outputNodeId: 'paint' }],
		maskBindings: [], repairs: { schemaVersion: 1, spots: [{ id: identifier, mode: 'heal', enabled,
			target: { x: 0.7, y: 0.5 }, source: { x: 0.2, y: 0.5 }, radius: 0.15, feather: 0, opacity: 1 }] } };
}
function process2() {
	const value = repair();
	return { processVersion: 2, effects: value.effects, geometry: value.geometry, masks: value.masks, maskBindings: value.maskBindings };
}
function retained() {
	const photo = photoArchiveFixture().photo, develop = repair(false);
	const workspace = { schemaVersion: 3, kind: 'photo-develop-workspace',
		entries: [{ ...step('Original'), develop: photo.versions[0]!.develop }, { ...step('Repair redo'), develop }], cursor: 0,
		snapshots: [{ id: 'saved', name: 'Repair snapshot', createdAt: CREATED, develop }] };
	const versions: { id: string; kind: string; name: string; createdAt: string;
		develop: typeof develop | typeof photo.versions[number]['develop']; workspace?: typeof workspace }[] = [
		{ ...photo.versions[0]!, workspace }, { id: 'copy', kind: 'virtual-copy', name: 'Inactive repair', createdAt: CREATED, develop }];
	return { ...photo, schemaVersion: 3, versions };
}

test('strict Photo3 retains inactive repaired versions, redo and snapshots as detached deeply frozen metadata', () => {
	const raw = retained(), before = structuredClone(raw), result = normalizePhotoDocumentV3(raw);
	assert.equal(result.schemaVersion, 3); assert.equal(result.versions[0]?.develop.processVersion, 1);
	assert.equal(result.versions[0]?.workspace?.schemaVersion, 3);
	assert.equal(result.versions[0]?.workspace?.entries[1]?.develop.processVersion, 3);
	assert.equal(result.versions[0]?.workspace?.snapshots[0]?.develop.processVersion, 3);
	assert.deepEqual(result.versions[1]?.develop, normalizeImageDevelopStateV3(before.versions[1]!.develop));
	assert.deepEqual(result.original, before.original); assert.deepEqual(result.extractedMetadata, before.extractedMetadata);
	const selected = result.versions[1]!.develop;
	assert.equal(selected.processVersion, 3);
	if (selected.processVersion !== 3) throw new Error('Expected repair recipe.');
	assert.equal(selected.repairs.spots[0]?.enabled, false); assert.equal(selected.masks[0]?.schemaVersion, 2);
	assert.equal(selected.masks[0]?.inputs.find(input => input.name === 'Paint')?.sourceRef, BRUSH);
	assert.equal(selected.masks[0]?.inputs.find(input => input.name === 'Unused')?.sourceRef, 'external-unused');
	assert.equal(selected.effects[0]?.enabled, false); assert.equal(Object.isFrozen(selected.repairs.spots[0]?.source), true);
	assert.equal(Object.isFrozen(result.versions[0]?.workspace?.snapshots), true); assert.equal(Object.isFrozen(result.original), true);
	const mutable = raw.versions[1]!.develop;
	if (!('repairs' in mutable)) throw new Error('Expected mutable repair fixture.');
	mutable.repairs.spots[0]!.source.x = 0.9;
	assert.deepEqual(result, normalizePhotoDocumentV3(before));
	assert.deepEqual(parsePhotoDocumentCurrentV1(serializePhotoDocumentCurrentV1(result)), result);
});

test('current Photo dispatch preserves exact legacy bytes and explicit promotion never upgrades on load', () => {
	const legacy = photoArchiveFixture().photo;
	for (const photo of [legacy, upgradePhotoDocumentV2(legacy)]) {
		assert.equal(serializePhotoDocumentCurrentV1(photo), serializePhotoDocumentV1OrV2(photo));
		assert.deepEqual(normalizePhotoDocumentCurrentV1(photo), photo);
		assert.equal(parsePhotoDocumentCurrentV1(serializePhotoDocumentCurrentV1(photo)).schemaVersion, photo.schemaVersion);
		const promoted = upgradePhotoDocumentV3(photo);
		assert.deepEqual(promoted, { ...photo, schemaVersion: 3 });
		assert.deepEqual(upgradePhotoDocumentV3(promoted), promoted);
		assert.equal(promoted.versions[0]?.develop.processVersion, 1);
	}
});

test('strict old Photo and workspace frontdoors refuse schema3 and never adopt repairs into schema1 or2', () => {
	const raw = retained(), workspace = raw.versions[0]!.workspace!;
	for (const owner of [normalizePhotoDocumentV1, normalizePhotoDocumentV2, normalizePhotoDocumentV1OrV2]) assert.throws(() => owner(raw));
	for (const schemaVersion of [1, 2]) assert.throws(() => normalizePhotoDocumentV1OrV2({ ...raw, schemaVersion }));
	assert.throws(() => normalizePhotoDevelopWorkspaceV1(workspace));
	assert.throws(() => normalizePhotoDevelopWorkspaceV1OrV2(workspace));
	for (const schemaVersion of [1, 2]) assert.throws(() => normalizePhotoDevelopWorkspaceV1OrV2({ ...workspace, schemaVersion }));
});

test('Photo3 selected history equality and existing identity, original and metadata constraints remain strict', () => {
	const raw = retained();
	assert.throws(() => normalizePhotoDocumentV3({ ...raw, versions: raw.versions.map(version => version.workspace ? { ...version, develop: repair() } : version) }));
	for (const patch of [{ schemaFamily: 'framescaper' }, { kind: 'photo-catalog' }, { activeVersionId: 'missing' },
		{ versions: [...raw.versions, ...raw.versions] }, { versions: raw.versions.map(version => ({ ...version, kind: 'virtual-copy' })) },
		{ original: { ...raw.original, retention: 'remote' } }, { rating: 6 }]) assert.throws(() => normalizePhotoDocumentV3({ ...raw, ...patch }));
	assert.deepEqual(normalizePhotoDocumentV3(raw).original, raw.original);
});

test('current Photo version admission refuses future, accessor and coercion without unrelated metadata inspection', () => {
	let inspected = 0, invoked = 0;
	for (const schemaVersion of [0, 4, '3', undefined, { valueOf() { invoked++; return 3; } }]) {
		const raw = new Proxy({ schemaVersion }, { ownKeys(target) { inspected++; return Reflect.ownKeys(target); },
			getOwnPropertyDescriptor(target, key) { if (key !== 'schemaVersion') inspected++; return Reflect.getOwnPropertyDescriptor(target, key); } });
		assert.throws(() => normalizePhotoDocumentCurrentV1(raw));
	}
	assert.throws(() => normalizePhotoDocumentCurrentV1({ get schemaVersion() { invoked++; return 3; } }));
	assert.equal(inspected, 0); assert.equal(invoked, 0);
});

test('Photo3 and workspace3 reject capabilities, inherited values and accessors without invoking getters', () => {
	const raw = retained(), workspace = raw.versions[0]!.workspace!; let invoked = 0;
	for (const key of ['schemaVersion', 'versions', 'original', 'metadata']) {
		const value = { ...raw }; Object.defineProperty(value, key, { enumerable: true, get() { invoked++; return raw; } });
		assert.throws(() => normalizePhotoDocumentV3(value));
	}
	for (const value of [{ ...raw, body: Uint8Array.of(1) }, { ...raw, loadOriginal() { invoked++; } },
		{ ...raw, [Symbol('extra')]: true }, Object.create(raw) as unknown, null, []]) assert.throws(() => normalizePhotoDocumentV3(value));
	for (const key of ['schemaVersion', 'entries', 'cursor', 'snapshots']) {
		const value = { ...workspace }; Object.defineProperty(value, key, { enumerable: true, get() { invoked++; return workspace; } });
		assert.throws(() => normalizePhotoDevelopWorkspaceV3(value));
	}
	assert.throws(() => normalizePhotoDevelopWorkspaceV3({ ...workspace, source: {} }));
	assert.throws(() => normalizePhotoDevelopWorkspaceV3(Object.create(workspace) as unknown)); assert.equal(invoked, 0);
});

test('workspace current creates only the requested process and explicit edits promote to sticky3', () => {
	const legacy = defaultImageDevelopStateV1();
	const old1 = createPhotoDevelopWorkspaceV1(legacy, step('Original'));
	const old2 = createPhotoDevelopWorkspaceV2(process2(), step('Named LUT'));
	assert.equal(serializePhotoDevelopWorkspaceCurrentV1(old1), serializePhotoDevelopWorkspaceV1(old1));
	assert.equal(serializePhotoDevelopWorkspaceCurrentV1(old2), serializePhotoDevelopWorkspaceV1OrV2(old2));
	assert.deepEqual(createPhotoDevelopWorkspaceCurrentV1(legacy, step('Original')), old1);
	assert.deepEqual(createPhotoDevelopWorkspaceCurrentV1(process2(), step('Named LUT')), old2);
	assert.deepEqual(upgradePhotoDevelopWorkspaceV3(old1), { ...old1, schemaVersion: 3 });
	const edited = commitPhotoDevelopWorkspaceCurrentV1(old1, repair(), step('Heal'));
	assert.equal(edited.schemaVersion, 3); assert.deepEqual(edited.entries.map(entry => entry.develop.processVersion), [1, 3]);
	const selected = selectPhotoDevelopHistoryCurrentV1(edited, 0);
	assert.equal(selected.schemaVersion, 3); assert.equal(selected.entries[1]?.develop.processVersion, 3);
	const branched = commitPhotoDevelopWorkspaceCurrentV1(selected, { ...legacy, geometry: { ...legacy.geometry, flipHorizontal: true } }, step('Legacy branch'));
	assert.equal(branched.schemaVersion, 3); assert.deepEqual(branched.entries.map(entry => entry.label), ['Original', 'Legacy branch']);
	assert.deepEqual(parsePhotoDevelopWorkspaceCurrentV1(serializePhotoDevelopWorkspaceCurrentV1(branched)), branched);
});

test('repair snapshots remain complete across legacy selection, branching, restore and explicit deletion', () => {
	let workspace = createPhotoDevelopWorkspaceCurrentV1(defaultImageDevelopStateV1(), step('Original'));
	workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, repair(false), step('Inactive repair'));
	workspace = savePhotoDevelopSnapshotCurrentV1(workspace, { id: 'repair', name: 'Disabled repair', createdAt: CREATED });
	workspace = selectPhotoDevelopHistoryCurrentV1(workspace, 0);
	workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, { ...defaultImageDevelopStateV1(), geometry: { ...defaultImageDevelopStateV1().geometry, flipVertical: true } }, step('Branch'));
	assert.equal(workspace.entries.length, 2); assert.equal(workspace.snapshots[0]?.develop.processVersion, 3);
	const restored = restorePhotoDevelopSnapshotCurrentV1(workspace, { snapshotId: 'repair', ...step('Restore') });
	assert.deepEqual(restored.entries[restored.cursor]?.develop, normalizeImageDevelopStateV3(repair(false)));
	const deleted = deletePhotoDevelopSnapshotCurrentV1(restored, 'repair');
	assert.equal(deleted.schemaVersion, 3); assert.equal(deleted.snapshots.length, 0); assert.deepEqual(deleted.entries, restored.entries);
	assert.throws(() => restorePhotoDevelopSnapshotCurrentV1(workspace, { snapshotId: 'missing', ...step('Missing') }));
	assert.throws(() => deletePhotoDevelopSnapshotCurrentV1(workspace, 'missing'));
});

test('empty and disabled repairs retain schema3 through workspace history without implicit downgrade', () => {
	for (const develop of [{ ...defaultImageDevelopStateV1(), processVersion: 3, repairs: { schemaVersion: 1, spots: [] } }, repair(false)]) {
		const workspace = createPhotoDevelopWorkspaceCurrentV1(develop, step('Repair profile'));
		assert.equal(workspace.schemaVersion, 3); assert.equal(workspace.entries[0]?.develop.processVersion, 3);
		assert.deepEqual(commitPhotoDevelopWorkspaceCurrentV1(workspace, develop, step('No change')), workspace);
		assert.equal(commitPhotoDevelopWorkspaceCurrentV1(workspace, defaultImageDevelopStateV1(), step('Clear effects')).schemaVersion, 3);
	}
});

test('workspace3 retains fixed history and snapshot capacities and rejects duplicate snapshots atomically', () => {
	let workspace = createPhotoDevelopWorkspaceCurrentV1(repair(), step('Initial'));
	for (let index = 0; index < 102; index++) workspace = commitPhotoDevelopWorkspaceCurrentV1(workspace, repair(false, `spot-${String(index)}`), step(`Repair ${String(index)}`));
	assert.equal(workspace.entries.length, 100); assert.equal(workspace.cursor, 99);
	for (let index = 0; index < 100; index++) workspace = savePhotoDevelopSnapshotCurrentV1(workspace,
		{ id: `saved-${String(index)}`, name: `Saved ${String(index)}`, createdAt: CREATED });
	assert.throws(() => savePhotoDevelopSnapshotCurrentV1(workspace, { id: 'saved-0', name: 'Replace', createdAt: CREATED }));
	assert.throws(() => savePhotoDevelopSnapshotCurrentV1(workspace, { id: 'overflow', name: 'Overflow', createdAt: CREATED }));
	assert.equal(workspace.snapshots.length, 100);
	assert.throws(() => normalizePhotoDevelopWorkspaceCurrentV1({ ...workspace, cursor: 100 }));
	assert.throws(() => normalizePhotoDevelopWorkspaceCurrentV1({ ...workspace, entries: [...workspace.entries, workspace.entries[0]] }));
});

test('Photo3 applies the unchanged complete document two-MiB gate and current parsers reject oversized UTF8 before JSON', () => {
	const base = photoArchiveFixture().photo, small = repair(false);
	const large = { ...small, effects: Array.from({ length: 256 }, (_, index) => ({ ...small.effects[0], id: `lut-${String(index)}` })) };
	const workspace = { schemaVersion: 3, kind: 'photo-develop-workspace', entries: Array.from({ length: 14 }, () => ({ ...step('Large recipe'), develop: large })), cursor: 0, snapshots: [] };
	const version = { ...base.versions[0], develop: large, workspace };
	const one = normalizePhotoDocumentV3({ ...base, schemaVersion: 3, versions: [version] });
	assert.ok(new TextEncoder().encode(serializePhotoDocumentCurrentV1(one)).byteLength <= 2_097_152);
	assert.throws(() => normalizePhotoDocumentV3({ ...base, schemaVersion: 3, versions: [version, { ...version, id: 'copy', kind: 'virtual-copy' }] }), /byte budget/u);
	for (const parse of [parsePhotoDocumentCurrentV1, parsePhotoDevelopWorkspaceCurrentV1]) {
		assert.throws(() => parse(' '.repeat(2_097_153)), /byte budget/u);
		assert.throws(() => parse(`"${'é'.repeat(1_048_576)}"`), /byte budget/u);
	}
});

test('current workspace dispatch refuses future versions and raw old envelopes containing repairs', () => {
	const raw = retained().versions[0]!.workspace!; let invoked = 0;
	assert.throws(() => normalizePhotoDevelopWorkspaceV3({ ...raw, schemaVersion: 4 }));
	for (const schemaVersion of [0, 5, '3', { valueOf() { invoked++; return 3; } }]) assert.throws(() => normalizePhotoDevelopWorkspaceCurrentV1({ ...raw, schemaVersion }));
	for (const schemaVersion of [1, 2]) assert.throws(() => normalizePhotoDevelopWorkspaceCurrentV1({ ...raw, schemaVersion }));
	assert.throws(() => normalizePhotoDevelopWorkspaceCurrentV1({ get schemaVersion() { invoked++; return 3; } }));
	assert.equal(invoked, 0);
});
