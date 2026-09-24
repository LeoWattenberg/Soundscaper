/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { createAudioEditorSessionController } from '../src/common/editor/session.js';

function project(id: string, title: string, clipId: string) {
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		id, title, revision: 0, sources: [], tracks: [],
		clips: [{ id: clipId, sourceId: `${clipId}-source` }],
		projectBin: { clips: [{ id: `${clipId}-bin`, sourceId: `${clipId}-bin-source` }] },
		assistanceAssets: [{ sourceId: `${clipId}-assistance-source` }],
	};
}

test('history sync avoids eagerly copying the undo graph while external views stay detached', () => {
	const initial = project('first', 'Initial', 'first-clip');
	const other = project('second', 'Other', 'second-clip');
	const session = createAudioEditorSessionController({ projects: [initial, other] });
	const before = session.getSnapshot();
	const incoming = {
		limit: 200, present: project('first', 'Updated', 'updated-clip'),
		undoStack: [{ project: initial, command: { type: 'project/rename' } }], redoStack: [],
	};
	const nativeClone = globalThis.structuredClone;
	let historyClones = 0;
	globalThis.structuredClone = (value, options) => {
		if (value && typeof value === 'object' && 'undoStack' in value && 'present' in value) {
			historyClones += 1;
		}
		return nativeClone(value, options);
	};
	try {
		const result = session.updateProjectHistory(initial.id, incoming, { returnHistory: false });
		assert.equal(Object.hasOwn(result, 'history'), false);
		assert.equal(historyClones, 1);
		const current = session.getSnapshot();
		assert.deepEqual(current.tabs.map((tab: { title: string }) => tab.title), ['Updated', 'Other']);
		assert.equal(historyClones, 1);
		const exposed = current.tabs[0]!.history;
		assert.equal(historyClones, 2);
		assert.equal(current.tabs[0]!.history, exposed);
		assert.equal(before.tabs[0]!.history.present.title, 'Initial');
		assert.equal(historyClones, 3);
		incoming.present.title = 'Changed by caller';
		exposed.present.title = 'Changed through snapshot';
		assert.equal(session.getProjectHistory(initial.id).present.title, 'Updated');
		const serialized = session.serialize();
		assert.equal(serialized.tabs[0]!.history.present.title, 'Updated');
	} finally {
		globalThis.structuredClone = nativeClone;
	}
});

test('session retention roots include history clips, project bin clips and assistance sources without exposing projects', () => {
	const initial = project('first', 'Initial', 'first-clip');
	const session = createAudioEditorSessionController({ projects: [initial] });
	const roots = session.getHistoryRetentionRoots();
	assert.deepEqual([...roots.clipIds].sort(), ['first-clip', 'first-clip-bin']);
	assert.deepEqual([...roots.assistanceSourceIds], ['first-clip-assistance-source']);
	roots.clipIds.clear();
	roots.assistanceSourceIds.clear();
	const retained = session.getHistoryRetentionRoots();
	assert.equal(retained.clipIds.has('first-clip'), true);
	assert.equal(retained.assistanceSourceIds.has('first-clip-assistance-source'), true);
});

test('explicit immutable history adoption shares hardened entries but keeps public snapshots detached', () => {
	const initial = project('first', 'Initial', 'first-clip');
	const session = createAudioEditorSessionController({ projects: [initial] });
	const first = {
		limit: 200, present: project('first', 'First', 'first-new'),
		undoStack: [{ project: initial, command: { type: 'project/rename' } }], redoStack: [],
	};
	const nativeClone = globalThis.structuredClone;
	let historyClones = 0;
	globalThis.structuredClone = (value, options) => {
		if (value && typeof value === 'object' && 'undoStack' in value && 'present' in value) {
			historyClones += 1;
		}
		return nativeClone(value, options);
	};
	try {
		session.updateProjectHistory(initial.id, first, {
			returnHistory: false, adoptImmutableHistory: true,
		});
		assert.equal(historyClones, 0);
		assert.equal(Object.isFrozen(first), true);
		assert.equal(Object.isFrozen(first.undoStack[0]!.project.clips[0]), true);
		assert.throws(() => { first.present.title = 'Caller mutation'; }, TypeError);
		const second = { ...first, present: project('first', 'Second', 'second-new') };
		session.updateProjectHistory(initial.id, second, {
			returnHistory: false, adoptImmutableHistory: true,
		});
		assert.equal(historyClones, 0);
		assert.equal(Object.isFrozen(second.present), true);
		const exposed = session.getSnapshot().tabs[0]!.history;
		exposed.present.title = 'Snapshot mutation';
		assert.equal(session.getProjectHistory(initial.id).present.title, 'Second');
	} finally {
		globalThis.structuredClone = nativeClone;
	}
});

test('immutable adoption falls back to cloning histories with mutable non-plain values', () => {
	const initial = project('first', 'Initial', 'first-clip');
	const session = createAudioEditorSessionController({ projects: [initial] });
	const metadata = new Date('2026-09-24T00:00:00.000Z');
	const incoming = { limit: 200, present: initial, undoStack: [], redoStack: [], metadata };
	const nativeClone = globalThis.structuredClone;
	let historyClones = 0;
	globalThis.structuredClone = (value, options) => {
		if (value && typeof value === 'object' && 'undoStack' in value && 'present' in value) {
			historyClones += 1;
		}
		return nativeClone(value, options);
	};
	try {
		session.updateProjectHistory(initial.id, incoming, {
			returnHistory: false, adoptImmutableHistory: true,
		});
		assert.equal(historyClones, 1);
		assert.equal(Object.isFrozen(incoming), false);
		metadata.setUTCFullYear(2000);
		assert.equal(session.getProjectHistory(initial.id).metadata.getUTCFullYear(), 2026);
	} finally {
		globalThis.structuredClone = nativeClone;
	}
});
