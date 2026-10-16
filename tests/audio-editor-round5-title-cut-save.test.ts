/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('ordinary Title Cut, Save and Paste remain writable through the real repository', async context => {
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
	await controller.actions.project.save();
	const original = controller.project?.clips.at(-1);
	assert.ok(original);
	const projectId = controller.project?.id;
	assert.ok(projectId);
	const historyCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.timeline.selectClip(original.id);
	await controller.actions.edit.cut();
	assert.equal(controller.project?.clips.length, 0);
	await controller.actions.project.save();
	assert.equal(controller.getSnapshot().readOnly, false);
	assert.equal(controller.getSnapshot().save.state, 'saved');
	const emptyStored = environment.runtime.cloneProject(await environment.store.loadProject(projectId));
	assert.equal(emptyStored.clips.length, 0);
	assert.equal(emptyStored.sources.some(source => source.id === original.sourceId), false);
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 1);
	await controller.actions.edit.paste();
	await controller.actions.project.save();
	assert.notEqual(controller.getSnapshot().status.state, 'error');
	assert.equal(controller.getSnapshot().readOnly, false);
	assert.equal(controller.project?.clips.length, 1);
	assert.equal(controller.getSnapshot().save.state, 'saved');
	assert.equal(controller.getSnapshot().history.undoEntries.length, historyCount + 2);
	controller.actions.edit.undo();
	assert.equal(controller.project?.clips.length, 0);
	controller.actions.edit.undo();
	assert.equal(controller.project?.clips.length, 1);
	assert.equal(controller.project?.clips[0]?.id, original.id);
	await controller.actions.project.save();
	const restoredStored = environment.runtime.cloneProject(await environment.store.loadProject(projectId));
	assert.equal(restoredStored.clips[0]?.id, original.id);
	assert.equal(restoredStored.sources.some(source => source.id === original.sourceId), true);
});
