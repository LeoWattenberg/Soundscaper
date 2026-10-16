/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createRecordingNotesActionFacade } from '../src/common/editor/controller/document/recording-notes-action-facade.ts';
import { readProjectRecordingNotes } from '../src/common/editor/recording-notes.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import {
	createSoundscaperProjectHistory,
	executeSoundscaperProjectCommand,
	redoSoundscaperProjectCommand,
	undoSoundscaperProjectCommand,
} from '../src/soundscaper/editor-project-history.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import {
	createSoundscaperProject,
	loadSoundscaperProject,
	validateSoundscaperProject,
} from '../src/soundscaper/editor-project.ts';

const NOW = '2026-10-05T12:00:00.000Z';
const NOTES = '# Session 1\n\n**Mic:** U87\n- First take\n- _Keep_ the ending\n\n`48 kHz` — Grüße 🎙️\n';

test('recording notes default to empty and older projects remain editable', () => {
	const project = createSoundscaperProject({ now: NOW });
	assert.equal(readProjectRecordingNotes(project), '');
	const older = structuredClone(project);
	delete (older.metadata as Record<string, unknown>).recordingNotes;
	const loaded = loadSoundscaperProject(older);
	assert.equal(loaded.readOnly, false);
	assert.equal(readProjectRecordingNotes(loaded.project), '');
	assert.equal(readProjectRecordingNotes(null), '');
});

test('project creation and ordinary metadata edits preserve Markdown source exactly', () => {
	const project = createSoundscaperProject({ now: NOW, metadata: { recordingNotes: NOTES } });
	assert.equal(readProjectRecordingNotes(project), NOTES);
	const edited = applySoundscaperProjectCommand(project, {
		type: 'metadata/update', changes: { artist: 'Musician', comments: 'Release copy' },
	}, { now: NOW });
	assert.equal(readProjectRecordingNotes(edited), NOTES);
	assert.equal(edited.metadata.comments, 'Release copy');
});

test('recording notes reject malformed persisted values and command payloads', () => {
	assert.throws(() => createSoundscaperProject({ metadata: { recordingNotes: 123 } }), /recording notes|recordingNotes/iu);
	const project = createSoundscaperProject({ now: NOW });
	const malformed = structuredClone(project);
	(malformed.metadata as Record<string, unknown>).recordingNotes = ['text'];
	assert.throws(() => validateSoundscaperProject(malformed), /recording notes|recordingNotes/iu);
	assert.throws(() => applySoundscaperProjectCommand(project, {
		type: 'project/recording-notes-set', notes: 123,
	} as never), /recording notes|recordingNotes/iu);
});

test('recording notes commands create undoable edits and clearing can be undone', () => {
	const initial = createSoundscaperProjectHistory(createSoundscaperProject({ now: NOW }));
	const written = executeSoundscaperProjectCommand(initial, {
		type: 'project/recording-notes-set', notes: NOTES,
	}, { now: NOW });
	assert.equal(readProjectRecordingNotes(initial.present), '');
	assert.equal(readProjectRecordingNotes(written.present), NOTES);
	assert.equal(written.present.revision, initial.present.revision + 1);
	const undone = undoSoundscaperProjectCommand(written, { now: NOW });
	assert.equal(readProjectRecordingNotes(undone.present), '');
	const redone = redoSoundscaperProjectCommand(undone, { now: NOW });
	assert.equal(readProjectRecordingNotes(redone.present), NOTES);
	const cleared = executeSoundscaperProjectCommand(redone, {
		type: 'project/recording-notes-set', notes: '',
	}, { now: NOW });
	assert.equal(readProjectRecordingNotes(cleared.present), '');
	assert.equal(readProjectRecordingNotes(undoSoundscaperProjectCommand(cleared).present), NOTES);
});

test('the recording notes action commits only changed values and follows the current project', () => {
	const first = createSoundscaperProject({ id: 'first', now: NOW });
	let active = first;
	let commits = 0;
	const actions = createRecordingNotesActionFacade({
		getProject: () => active,
		commit: (command, selection, options) => {
			assert.deepEqual(selection, {});
			assert.deepEqual(options, { skipPlaybackEngine: true });
			commits += 1;
			active = applySoundscaperProjectCommand(active, command, { now: NOW });
		},
	});
	actions.update('');
	assert.equal(commits, 0);
	actions.update(NOTES);
	assert.equal(commits, 1);
	const editedFirst = active;
	actions.update(NOTES);
	assert.equal(commits, 1);
	active = createSoundscaperProject({ id: 'second', now: NOW });
	assert.equal(readProjectRecordingNotes(active), '');
	actions.update('Second session');
	assert.equal(readProjectRecordingNotes(active), 'Second session');
	assert.equal(readProjectRecordingNotes(editedFirst), NOTES);
	assert.equal(readProjectRecordingNotes(first), '');
});

test('local project revisions preserve recording notes independently across reloads', async (context) => {
	const store = memoryStore(context);
	const first = createSoundscaperProject({ id: 'first', now: NOW, metadata: { recordingNotes: NOTES } });
	const second = createSoundscaperProject({ id: 'second', now: NOW });
	await store.saveProject(first);
	await store.saveProject(second);
	const changed = applySoundscaperProjectCommand(first, {
		type: 'project/recording-notes-set', notes: 'Updated notes',
	}, { now: NOW });
	await store.saveProject(changed);
	await store.close();
	const reloaded = memoryStore(context);
	assert.equal(readProjectRecordingNotes(await reloaded.loadProject(first.id)), 'Updated notes');
	assert.equal(readProjectRecordingNotes(await reloaded.loadProject(first.id, { revision: first.revision })), NOTES);
	assert.equal(readProjectRecordingNotes(await reloaded.loadProject(second.id)), '');
});

test('native .scape export and import roundtrip recording notes with the project', async (context) => {
	const sender = memoryStore(context);
	const recipient = memoryStore(context);
	const project = createSoundscaperProject({ now: NOW, metadata: { recordingNotes: NOTES } });
	const runtime = createSoundscaperScapeNativeRuntime();
	const archive = await runtime.exportScapeProject(project, sender);
	assert.ok(archive.blob instanceof Blob);
	const imported = await runtime.importScapeProject(archive.blob, recipient);
	assert.equal(imported.readOnly, false);
	assert.equal(readProjectRecordingNotes(imported.project), NOTES);
	assert.equal(readProjectRecordingNotes(await recipient.loadProject(imported.project.id)), NOTES);
});

function memoryStore(context: TestContext) {
	const store = createSoundscaperProjectStore({ indexedDB: null });
	context.after(async () => { await store.close(); });
	return store;
}
