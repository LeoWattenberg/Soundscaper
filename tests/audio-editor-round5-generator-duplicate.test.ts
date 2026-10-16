/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('public Edit Duplicate preserves generated Title identities and atomic history', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller);
	assert.ok(authoring);
	await authoring.run('video-title');
	const original = controller.project?.clips.at(-1);
	assert.ok(original);
	controller.actions.timeline.selectClip(original.id);
	const before = structuredClone(controller.project);
	assert.ok(before);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.edit.duplicate();
	const after = structuredClone(controller.project);
	assert.ok(after);
	assert.equal(after.clips.length, 2, JSON.stringify(controller.getSnapshot().status));
	assert.equal(after.tracks.length, before.tracks.length + 1);
	assert.deepEqual(after.sources.slice(0, before.sources.length), before.sources);
	assert.deepEqual(after.clips.find(clip => clip.id === original.id), original);
	const copy = after.clips.find(clip => clip.id !== original.id);
	assert.ok(copy);
	assert.deepEqual({ ...copy, id: original.id, sourceId: original.sourceId }, original);
	const originalSource = before.sources.find(source => source.id === original.sourceId);
	const copiedSource = after.sources.find(source => source.id === copy.sourceId);
	assert.ok(originalSource);
	assert.ok(copiedSource);
	assert.deepEqual({ ...copiedSource, id: originalSource.id }, originalSource);
	assert.deepEqual(new Set(controller.project?.selection.clipIds), new Set(after.clips.map(clip => clip.id)));
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.clips, before.clips);
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.clips, after.clips);
	assert.deepEqual(controller.project?.tracks, after.tracks);
});
