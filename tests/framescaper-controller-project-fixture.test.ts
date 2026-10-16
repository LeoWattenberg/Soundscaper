/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import {
	createFramescaperFixtureController,
	framescaperPublishedProject,
} from './helpers/framescaper-controller-project-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('fixture observation rejects absent, foreign, future and mutable project views', () => {
	for (const project of [null, Object.freeze({ schemaFamily: 'soundscaper', schemaVersion: 1 }),
		Object.freeze({ schemaFamily: 'framescaper', schemaVersion: 2 }),
		{ schemaFamily: 'framescaper', schemaVersion: 1 }]) {
		assert.throws(() => framescaperPublishedProject(project), assert.AssertionError);
	}
});

test('a persisted controller fixture starts directly and publishes stable frozen comparison snapshots', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, framescaperBaselineOptions());
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = await createFramescaperFixtureController(environment, project.id);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	assert.equal(controller.project?.id, project.id);
	assert.deepEqual((await environment.store.listProjects()).map(row => row.id), [project.id]);
	const published = controller.project;
	const before = framescaperPublishedProject(published);
	assert.equal(before, published);
	assert.equal(framescaperPublishedProject(controller.project), before);
	assert.equal(Object.isFrozen(before), true);
	assert.equal(Object.isFrozen(before.tracks), true);
	assert.equal(Object.isFrozen(before.tracks[0]), true);
	assert.equal(Object.isFrozen(before.clips), true);
	assert.equal(Object.isFrozen(before.sources), true);
	const beforeTracks = structuredClone(before.tracks);
	assert.equal(Reflect.set(before.tracks[0]!, 'name', 'mutated'), false);
	controller.actions.track.muteAll();
	const after = framescaperPublishedProject(controller.project);
	assert.notEqual(after, before);
	assert.deepEqual(before.tracks, beforeTracks);
	assert.equal(before.tracks.find(row => row.id === 'audio-track')?.mute, false);
	assert.equal(after.tracks.find(row => row.id === 'audio-track')?.mute, true);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.tracks, after.tracks);
});
