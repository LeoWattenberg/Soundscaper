/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('global Mute and Unmute control camera visibility and audio mute in one undo transaction', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, framescaperBaselineOptions());
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	await controller.actions.project.openById(project.id);
	const before = controller.project;
	assert.ok(before);
	const undoCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.track.muteAll();
	assert.equal(controller.project?.tracks.find(({ id }) => id === 'video-track')?.hidden, true);
	assert.equal(controller.project?.tracks.find(({ id }) => id === 'audio-track')?.mute, true);
	assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.equal(controller.project?.tracks.find(({ id }) => id === 'video-track')?.hidden, true);
	controller.actions.track.unmuteAll();
	assert.equal(controller.project?.tracks.find(({ id }) => id === 'video-track')?.hidden, false);
	assert.equal(controller.project?.tracks.find(({ id }) => id === 'audio-track')?.mute, false);
	controller.actions.track.unmuteAll();
	assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 2,
		'repeating an already satisfied command does not add history');
});
