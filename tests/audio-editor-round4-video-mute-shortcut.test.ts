/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { createAudacityActionRuntime } from '../src/common/editor/audacity-action-runtime.js';

for (const action of ['track-mute', 'mute-tracks'] as const) test(`${action} owns canonical camera track visibility and keeps audio mute semantics`, async context => {
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
	controller.actions.timeline.selectClip('video-clip');
	const id = 'video-track';
	const track = controller.project?.tracks.find(candidate => candidate.id === id);
	assert.ok(track);
	assert.equal(track.hidden, false);
	const undoCount = controller.getSnapshot().history.undoEntries.length;
	const runtime = createAudacityActionRuntime(controller, { productId: 'framescaper' });
	await runtime.actions.track.audacityMixer(action);
	assert.equal(controller.project?.tracks.find(candidate => candidate.id === id)?.hidden, true);
	assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.tracks.find(candidate => candidate.id === id), track);
	controller.actions.edit.redo();
	assert.equal(controller.project?.tracks.find(candidate => candidate.id === id)?.hidden, true);
	await runtime.actions.track.audacityMixer(action === 'track-mute' ? action : 'unmute-tracks');
	assert.equal(controller.project?.tracks.find(candidate => candidate.id === id)?.hidden, false);
	controller.actions.timeline.selectClip('audio-clip');
	await runtime.actions.track.audacityMixer(action);
	assert.equal(controller.project?.tracks.find(candidate => candidate.id === 'audio-track')?.mute, true);
	assert.equal(controller.project?.tracks.find(candidate => candidate.id === id)?.hidden, false);
	await runtime.actions.track.audacityMixer(action === 'track-mute' ? action : 'unmute-tracks');
	assert.equal(controller.project?.tracks.find(candidate => candidate.id === 'audio-track')?.mute, false);
});
