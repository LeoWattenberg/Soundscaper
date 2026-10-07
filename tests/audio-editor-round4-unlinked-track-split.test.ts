/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const mode of ['clip', 'range'] as const) test(`unlinked camera audio lifts onto an independent track for ${mode} selection`, async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const options = framescaperBaselineOptions();
	assert.ok(Array.isArray(options.tracks)); assert.ok(Array.isArray(options.clips));
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { ...options,
		tracks: (options.tracks as Record<string, unknown>[]).map(track => ({ ...track, laneGroupId: 'camera-lanes' })),
		clips: (options.clips as Record<string, unknown>[]).map(clip => ({ ...clip, avLinkId: 'camera-link' })) });
	assert.ok(await environment.createProjectIfAbsent(project));
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); });
	await controller.ready;
	await controller.actions.project.openById(project.id);
	controller.actions.timeline.selectClip('audio-clip');
	controller.actions.video.unlink('audio-clip');
	controller.actions.timeline.selectClip('audio-clip');
	if (mode === 'range') controller.actions.timeline.setSelection(10_000, 30_000, { trackIds: ['audio-track'] });
	else controller.actions.transport.seek(20_000);
	const before = controller.project!;
	const undoCount = controller.getSnapshot().history.undoEntries.length;
	controller.actions.edit.splitIntoNewTrack();
	const after = controller.project!;
	const derived = after.tracks.find(track => track.id === controller.getSnapshot().selectedTrackId);
	assert.ok(derived);
	assert.notEqual(derived.id, 'audio-track');
	assert.equal(derived.laneGroupId, null);
	assert.deepEqual(after.tracks.filter(track => track.id === 'video-track' || track.id === 'audio-track')
		.map(track => ({ id: track.id, laneGroupId: track.laneGroupId })),
		[{ id: 'video-track', laneGroupId: 'camera-lanes' }, { id: 'audio-track', laneGroupId: 'camera-lanes' }]);
	assert.equal(after.tracks.length, before.tracks.length + 1);
	assert.deepEqual(after.sources, before.sources);
	assert.equal(controller.getSnapshot().history.undoEntries.length, undoCount + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project!.tracks, before.tracks);
	assert.deepEqual(controller.project!.clips, before.clips);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project!.tracks, after.tracks);
	assert.deepEqual(controller.project!.clips, after.clips);
});
