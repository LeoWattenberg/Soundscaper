/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createPhotoDevelopWorkspaceV1, commitPhotoDevelopWorkspaceV1, normalizePhotoDevelopWorkspaceV1,
	selectPhotoDevelopHistoryV1, savePhotoDevelopSnapshotV1, restorePhotoDevelopSnapshotV1,
	deletePhotoDevelopSnapshotV1, parsePhotoDevelopWorkspaceV1, serializePhotoDevelopWorkspaceV1,
	type PhotoDevelopWorkspaceV1 } from '../src/lightscaper/catalog/photo-develop-workspace-v1.ts';

const CREATED = '2026-10-09T00:00:00.000Z';
const step = (label: string) => ({ label, createdAt: CREATED });
const develop = (exposure: number) => ({ ...defaultPhotoDevelopV1(), effects: [createVideoEffect('tone-ladder-v1', {
	id: 'tone', params: { exposure },
})] });
const present = (state: PhotoDevelopWorkspaceV1) => state.entries[state.cursor]!.develop;

test('named snapshots retain detached settings independently of history and never overwrite captured content', () => {
	const donor = develop(1);
	let workspace = createPhotoDevelopWorkspaceV1(donor, step('Initial settings'));
	workspace = savePhotoDevelopSnapshotV1(workspace, { id: 'snapshot-1', name: 'Bright', createdAt: CREATED });
	assert.equal(Reflect.set(donor.effects[0]!.params, 'exposure', -2), true);
	workspace = commitPhotoDevelopWorkspaceV1(workspace, develop(2), step('Exposure +2'));
	assert.equal(workspace.snapshots[0]!.develop.effects[0]!.params.exposure, 1);
	assert.equal(present(workspace).effects[0]!.params.exposure, 2);
	assert.throws(() => savePhotoDevelopSnapshotV1(workspace, { id: 'snapshot-1', name: 'Replace', createdAt: CREATED }), /duplicate/iu);
	const restored = restorePhotoDevelopSnapshotV1(workspace, { snapshotId: 'snapshot-1', ...step('Restore Bright') });
	assert.equal(present(restored).effects[0]!.params.exposure, 1);
	assert.equal(restored.entries.length, 3);
	assert.deepEqual(restored.snapshots, workspace.snapshots);
	assert.equal(Object.isFrozen(restored.snapshots[0]!.develop.effects[0]!.params), true);
	const deleted = deletePhotoDevelopSnapshotV1(restored, 'snapshot-1');
	assert.equal(deleted.snapshots.length, 0);
	assert.deepEqual(present(deleted), present(restored));
});

test('selecting per-version history retains redo entries and an edit replaces only the abandoned future', () => {
	let workspace = createPhotoDevelopWorkspaceV1(develop(0), step('Initial settings'));
	workspace = commitPhotoDevelopWorkspaceV1(workspace, develop(1), step('One'));
	workspace = commitPhotoDevelopWorkspaceV1(workspace, develop(2), step('Two'));
	const undo = selectPhotoDevelopHistoryV1(workspace, 1);
	assert.equal(undo.entries.length, 3);
	assert.equal(present(undo).effects[0]!.params.exposure, 1);
	assert.deepEqual(present(selectPhotoDevelopHistoryV1(undo, 2)), present(workspace));
	const branched = commitPhotoDevelopWorkspaceV1(undo, develop(-1), step('New branch'));
	assert.deepEqual(branched.entries.map(entry => entry.label), ['Initial settings', 'One', 'New branch']);
	assert.equal(branched.cursor, 2);
	const noChange = commitPhotoDevelopWorkspaceV1(branched, develop(-1), step('Same settings'));
	assert.deepEqual(noChange, branched);
});

test('generated ordered stacks survive persistence and history branching without changing process versions', () => {
	let workspace = createPhotoDevelopWorkspaceV1(defaultPhotoDevelopV1(), step('Initial settings'));
	for (let index = 0; index < 140; index++) {
		const effects = [createVideoEffect('white-balance-v1', { id: 'wb', params: {
			temperature: ((index * 37) % 201) - 100, tint: ((index * 53) % 201) - 100,
		} }), createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: ((index % 11) - 5) } })];
		const candidate = { ...defaultPhotoDevelopV1(), effects };
		workspace = commitPhotoDevelopWorkspaceV1(workspace, candidate, step(`Edit ${index}`));
		const restored = parsePhotoDevelopWorkspaceV1(serializePhotoDevelopWorkspaceV1(workspace));
		assert.deepEqual(restored, workspace);
		assert.deepEqual(present(restored), candidate);
		assert.equal(present(restored).processVersion, 1);
		assert.equal(restored.cursor, restored.entries.length - 1);
	}
	assert.equal(workspace.entries.length, 100);
	assert.equal(workspace.entries[0]!.label, 'Edit 40');
	assert.throws(() => selectPhotoDevelopHistoryV1(workspace, 100), /history/iu);
});

test('workspace validation refuses future schemas, cursor errors, duplicate snapshot IDs and accessors', () => {
	const workspace = savePhotoDevelopSnapshotV1(createPhotoDevelopWorkspaceV1(develop(1), step('Initial settings')),
		{ id: 's', name: 'Saved', createdAt: CREATED });
	assert.throws(() => normalizePhotoDevelopWorkspaceV1({ ...workspace, schemaVersion: 2 }), /version/iu);
	assert.throws(() => normalizePhotoDevelopWorkspaceV1({ ...workspace, cursor: 1 }), /cursor/iu);
	assert.throws(() => normalizePhotoDevelopWorkspaceV1({ ...workspace, snapshots: [...workspace.snapshots, ...workspace.snapshots] }), /duplicate/iu);
	let reads = 0;
	const accessor = Object.defineProperty({ ...workspace }, 'entries', { enumerable: true, get() { reads++; return []; } });
	assert.throws(() => normalizePhotoDevelopWorkspaceV1(accessor), /data|accessor/iu);
	assert.equal(reads, 0);
	assert.throws(() => parsePhotoDevelopWorkspaceV1(' '.repeat(2_097_153)), /byte/iu);
	assert.throws(() => restorePhotoDevelopSnapshotV1(workspace, { snapshotId: 'missing', ...step('Restore') }), /missing/iu);
	assert.throws(() => deletePhotoDevelopSnapshotV1(workspace, 'missing'), /missing/iu);
});

test('byte pressure evicts the oldest history while preserving present state and named snapshots', () => {
	const large = (index: number) => ({ ...defaultPhotoDevelopV1(), effects: Array.from({ length: 256 }, (_, effectIndex) =>
		createVideoEffect('tone-ladder-v1', { id: `effect-${effectIndex}`, params: { exposure: (index % 11) - 5 } })) });
	let workspace = createPhotoDevelopWorkspaceV1(large(0), step('Initial settings'));
	workspace = savePhotoDevelopSnapshotV1(workspace, { id: 'retained', name: 'Original settings', createdAt: CREATED });
	for (let index = 1; index < 70; index++) workspace = commitPhotoDevelopWorkspaceV1(workspace, large(index), step(`Large ${index}`));
	assert.ok(workspace.entries.length < 70);
	assert.equal(workspace.cursor, workspace.entries.length - 1);
	assert.deepEqual(present(workspace), large(69));
	assert.deepEqual(workspace.snapshots[0]!.develop, large(0));
	assert.ok(new TextEncoder().encode(serializePhotoDevelopWorkspaceV1(workspace)).byteLength <= 2_097_152);
});

test('seeded stack properties preserve snapshots through edits, history selection and serialization', () => {
	fc.assert(fc.property(fc.array(fc.record({ temperature: fc.integer({ min: -100, max: 100 }),
		tint: fc.integer({ min: -100, max: 100 }), exposure: fc.integer({ min: -20, max: 20 }) }),
	{ minLength: 1, maxLength: 12 }), controls => {
		let workspace = createPhotoDevelopWorkspaceV1(defaultPhotoDevelopV1(), step('Initial settings'));
		for (const control of controls) workspace = commitPhotoDevelopWorkspaceV1(workspace, { ...defaultPhotoDevelopV1(), effects: [
			createVideoEffect('white-balance-v1', { id: 'wb', params: { temperature: control.temperature, tint: control.tint } }),
			createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: control.exposure / 4 } }),
		] }, step('Generated edit'));
		const captured = present(workspace);
		workspace = savePhotoDevelopSnapshotV1(workspace, { id: 'property', name: 'Captured', createdAt: CREATED });
		workspace = selectPhotoDevelopHistoryV1(workspace, 0);
		workspace = commitPhotoDevelopWorkspaceV1(workspace, develop(4), step('Branch'));
		workspace = parsePhotoDevelopWorkspaceV1(serializePhotoDevelopWorkspaceV1(workspace));
		assert.deepEqual(workspace.snapshots[0]!.develop, captured);
		assert.deepEqual(present(restorePhotoDevelopSnapshotV1(workspace, { snapshotId: 'property', ...step('Restore') })), captured);
	}), { seed: 20261009, numRuns: 40 });
});

test('snapshot capacity refuses additions until explicit deletion without changing captured content', () => {
	let workspace = createPhotoDevelopWorkspaceV1(develop(1), step('Initial settings'));
	for (let index = 0; index < 100; index++) workspace = savePhotoDevelopSnapshotV1(workspace,
		{ id: `snapshot-${index}`, name: `Snapshot ${index}`, createdAt: CREATED });
	assert.throws(() => savePhotoDevelopSnapshotV1(workspace, { id: 'overflow', name: 'Overflow', createdAt: CREATED }), /capacity/iu);
	assert.equal(workspace.snapshots.length, 100);
	workspace = deletePhotoDevelopSnapshotV1(workspace, 'snapshot-0');
	workspace = savePhotoDevelopSnapshotV1(workspace, { id: 'new', name: 'New', createdAt: CREATED });
	assert.equal(workspace.snapshots.length, 100);
	assert.equal(workspace.snapshots[0]!.id, 'snapshot-1');
});
