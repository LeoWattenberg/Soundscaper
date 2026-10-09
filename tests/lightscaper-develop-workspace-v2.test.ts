/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createPhotoDevelopWorkspaceV1, normalizePhotoDevelopWorkspaceV1, serializePhotoDevelopWorkspaceV1 } from '../src/lightscaper/catalog/photo-develop-workspace-v1.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, normalizePhotoDevelopWorkspaceV2,
	normalizePhotoDevelopWorkspaceV1OrV2, upgradePhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2,
	savePhotoDevelopSnapshotV2, restorePhotoDevelopSnapshotV2, deletePhotoDevelopSnapshotV2,
	parsePhotoDevelopWorkspaceV1OrV2, serializePhotoDevelopWorkspaceV1OrV2 } from '../src/lightscaper/catalog/photo-develop-workspace-v2.ts';

const CREATED = '2026-10-09T00:00:00.000Z';
const step = (label: string) => ({ label, createdAt: CREATED });
const reference = (sha = '4') => ({ storageKey: `lut-sha256:${sha.repeat(64)}`, sha256: sha.repeat(64), byteLength: 88,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] });
const develop = (sha = '4', enabled = true) => ({ ...defaultImageDevelopStateV1(), processVersion: 2,
	effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled, params: { lut: reference(sha) } }] });

test('workspace2 opt-in preserves strict legacy workspace bytes and process1 history', () => {
	const legacy = createPhotoDevelopWorkspaceV1(defaultImageDevelopStateV1(), step('Before LUT'));
	assert.equal(serializePhotoDevelopWorkspaceV1OrV2(legacy), serializePhotoDevelopWorkspaceV1(legacy));
	assert.deepEqual(normalizePhotoDevelopWorkspaceV1OrV2(legacy), legacy);
	const upgraded = upgradePhotoDevelopWorkspaceV2(legacy);
	assert.deepEqual(upgraded, { ...legacy, schemaVersion: 2 });
	assert.deepEqual(upgradePhotoDevelopWorkspaceV2(upgraded), upgraded);
	assert.throws(() => normalizePhotoDevelopWorkspaceV1(upgraded));
	assert.throws(() => normalizePhotoDevelopWorkspaceV2(legacy));
});

test('LUT history and snapshots retain every disabled reference and redo state through serialization', () => {
	let workspace = createPhotoDevelopWorkspaceV2(defaultImageDevelopStateV1(), step('Original'));
	workspace = savePhotoDevelopSnapshotV2(workspace, { id: 'original', name: 'Original', createdAt: CREATED });
	workspace = commitPhotoDevelopWorkspaceV2(workspace, develop('4', false), step('Disabled LUT'));
	workspace = savePhotoDevelopSnapshotV2(workspace, { id: 'lut', name: 'LUT', createdAt: CREATED });
	workspace = commitPhotoDevelopWorkspaceV2(workspace, develop('5'), step('Second LUT'));
	workspace = selectPhotoDevelopHistoryV2(workspace, 0);
	const reopened = parsePhotoDevelopWorkspaceV1OrV2(serializePhotoDevelopWorkspaceV1OrV2(workspace));
	assert.equal(reopened.schemaVersion, 2); assert.equal(reopened.cursor, 0);
	assert.deepEqual(reopened.entries.map(entry => entry.develop.processVersion), [1, 2, 2]);
	assert.deepEqual(reopened.entries[1]?.develop.effects[0]?.params.lut, reference());
	assert.equal(reopened.entries[1]?.develop.effects[0]?.enabled, false);
	assert.deepEqual(reopened.snapshots[1]?.develop.effects[0]?.params.lut, reference());
	assert.deepEqual(reopened, workspace);
});

test('branching releases abandoned redo but retains a LUT snapshot and restores its exact process', () => {
	let workspace = createPhotoDevelopWorkspaceV2(defaultImageDevelopStateV1(), step('Original'));
	workspace = commitPhotoDevelopWorkspaceV2(workspace, develop(), step('LUT'));
	workspace = savePhotoDevelopSnapshotV2(workspace, { id: 'saved', name: 'Saved LUT', createdAt: CREATED });
	workspace = selectPhotoDevelopHistoryV2(workspace, 0);
	workspace = commitPhotoDevelopWorkspaceV2(workspace, develop('6'), step('Branch'));
	assert.deepEqual(workspace.entries.map(entry => entry.label), ['Original', 'Branch']);
	const restored = restorePhotoDevelopSnapshotV2(workspace, { snapshotId: 'saved', ...step('Restore') });
	assert.deepEqual(restored.entries[restored.cursor]?.develop, workspace.snapshots[0]?.develop);
	const deleted = deletePhotoDevelopSnapshotV2(restored, 'saved');
	assert.equal(deleted.snapshots.length, 0);
	assert.deepEqual(deleted.entries, restored.entries);
});

test('workspace2 owns detached LUT reference values and keeps explicit neutral recipes', () => {
	const raw = develop();
	const workspace = createPhotoDevelopWorkspaceV2(raw, step('LUT'));
	raw.effects[0]!.params.lut.domainMin[0] = -1;
	assert.deepEqual(workspace.entries[0]?.develop.effects[0]?.params.lut, reference());
	assert.ok(Object.isFrozen(workspace.entries[0]?.develop.effects[0]?.params.lut));
	const neutral = { ...develop(), effects: [{ id: 'profile', type: 'cube-lut-profile-v1', enabled: true, params: { lut: null } }] };
	const edited = commitPhotoDevelopWorkspaceV2(workspace, neutral, step('Neutral profile'));
	assert.equal(edited.entries[edited.cursor]?.develop.processVersion, 2);
	assert.deepEqual(edited.entries[edited.cursor]?.develop.effects[0]?.params, { lut: null });
	assert.deepEqual(commitPhotoDevelopWorkspaceV2(edited, neutral, step('No change')), edited);
});

test('workspace2 refuses incoherent, future and accessor-bearing persistence within unchanged bounds', () => {
	const workspace = createPhotoDevelopWorkspaceV2(develop(), step('LUT'));
	for (const schemaVersion of [0, 3, '2']) assert.throws(() => normalizePhotoDevelopWorkspaceV1OrV2({ ...workspace, schemaVersion }));
	assert.throws(() => normalizePhotoDevelopWorkspaceV2({ ...workspace, cursor: 1 }));
	assert.throws(() => normalizePhotoDevelopWorkspaceV2({ ...workspace, entries: [] }));
	assert.throws(() => normalizePhotoDevelopWorkspaceV2({ ...workspace, entries: Array.from({ length: 101 }, () => workspace.entries[0]) }));
	assert.throws(() => parsePhotoDevelopWorkspaceV1OrV2(' '.repeat(2_097_153)));
	let calls = 0;
	const accessor = Object.defineProperty({ ...workspace }, 'entries', { enumerable: true, get() { calls++; return []; } });
	assert.throws(() => normalizePhotoDevelopWorkspaceV2(accessor)); assert.equal(calls, 0);
	assert.throws(() => restorePhotoDevelopSnapshotV2(workspace, { snapshotId: 'missing', ...step('Restore') }));
	assert.throws(() => deletePhotoDevelopSnapshotV2(workspace, 'missing'));
});

test('workspace2 snapshot capacity stays fixed and rejects duplicate IDs without replacing content', () => {
	let workspace = createPhotoDevelopWorkspaceV2(develop(), step('LUT'));
	for (let index = 0; index < 100; index++) workspace = savePhotoDevelopSnapshotV2(workspace,
		{ id: `snapshot-${String(index)}`, name: `Snapshot ${String(index)}`, createdAt: CREATED });
	assert.throws(() => savePhotoDevelopSnapshotV2(workspace, { id: 'snapshot-0', name: 'Replace', createdAt: CREATED }));
	assert.throws(() => savePhotoDevelopSnapshotV2(workspace, { id: 'overflow', name: 'Overflow', createdAt: CREATED }));
	assert.deepEqual(workspace.snapshots[0]?.develop.effects[0]?.params.lut, reference());
	workspace = deletePhotoDevelopSnapshotV2(workspace, 'snapshot-0');
	assert.equal(savePhotoDevelopSnapshotV2(workspace, { id: 'next', name: 'Next', createdAt: CREATED }).snapshots.length, 100);
});

test('LUT reference history stays within the original byte budget while named snapshots remain retained', () => {
	const large = (index: number) => ({ ...develop(), effects: Array.from({ length: 256 }, (_, effectIndex) => ({
		id: `profile-${String(effectIndex)}`, type: 'cube-lut-profile-v1', enabled: false, params: { lut: reference(index % 2 ? '5' : '4') },
	})) });
	let workspace = createPhotoDevelopWorkspaceV2(large(0), step('Initial LUT stack'));
	workspace = savePhotoDevelopSnapshotV2(workspace, { id: 'saved', name: 'Original LUT stack', createdAt: CREATED });
	for (let index = 1; index <= 24; index++) workspace = commitPhotoDevelopWorkspaceV2(workspace, large(index), step(`Edit ${String(index)}`));
	assert.ok(workspace.entries.length < 25);
	assert.equal(workspace.cursor, workspace.entries.length - 1);
	assert.equal(workspace.entries[workspace.cursor]?.label, 'Edit 24');
	assert.deepEqual(workspace.snapshots[0]?.develop.effects[0]?.params.lut, reference());
	assert.ok(new TextEncoder().encode(serializePhotoDevelopWorkspaceV1OrV2(workspace)).byteLength <= 2_097_152);
	assert.deepEqual(parsePhotoDevelopWorkspaceV1OrV2(serializePhotoDevelopWorkspaceV1OrV2(workspace)), workspace);
});
